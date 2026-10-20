-- ============================================================================
-- KOPI BOY 2.0 — Rider location tracking (consent, live position, history)
-- Run this in the Supabase SQL Editor AFTER docs/supabase-schema.sql,
-- docs/supabase-admin-messages.sql (current_user_is_active) and
-- docs/supabase-delivery-pickup.sql. Safe to re-run.
--
-- What it adds:
--   1. rider_location_consent  — one row per rider who agreed to tracking.
--   2. rider_live_location     — one row per rider: their latest position.
--                                In the supabase_realtime publication.
--   3. rider_location_points   — the position history (admin read only).
--   4. report_rider_location() — the ONLY way a position gets written.
--   5. stop_rider_sharing()    — removes the rider's live row.
--   6. record_rider_location_consent() — the rider agrees (or re-agrees).
--   7. location_retention_months() + daily pg_cron purge
--      'kb-purge-rider-locations'.
--
-- Who can see what (RLS + grants on all three tables):
--   * admin (user_has_role('admin'), i.e. the Boss app): reads everything.
--   * a rider: reads only their own consent row and own live row; never
--     their history and never another rider.
--   * cooks and customers: nothing. No policy here mentions them.
-- Nobody writes the live/points tables from the app: no INSERT/UPDATE/DELETE
-- grant exists on them; the SECURITY DEFINER functions below do the writes.
--
-- NOTE: this is separate from the older public.rider_live_locations (plural,
-- one row per delivery) that RiderDeliveriesPanel/RiderLocationMap use today.
-- That table is not touched here.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RIDER_LOCATION_CONSENT
-- rider_id = the rider's profiles.id. consented_at always comes from the
-- database: the INSERT grant is column-level (rider_id, consent_version), so a
-- client can't send its own timestamp and the column default applies.
-- Re-consenting (a new consent_version) goes through
-- record_rider_location_consent() in section 7, which updates the row.
-- ----------------------------------------------------------------------------
create table if not exists public.rider_location_consent (
  rider_id uuid primary key references public.profiles(id) on delete cascade,
  consented_at timestamptz not null default now(),
  consent_version text not null
);

alter table public.rider_location_consent enable row level security;

-- select (own + admin), insert (own, rider only) — no update/delete policy.
revoke all on public.rider_location_consent from anon, authenticated;
grant select on public.rider_location_consent to authenticated;
grant insert (rider_id, consent_version) on public.rider_location_consent to authenticated;

drop policy if exists "Riders can read their own location consent" on public.rider_location_consent;
create policy "Riders can read their own location consent"
  on public.rider_location_consent for select
  using (auth.uid() = rider_id);

drop policy if exists "Riders can record their own location consent" on public.rider_location_consent;
create policy "Riders can record their own location consent"
  on public.rider_location_consent for insert
  with check (auth.uid() = rider_id and public.user_has_role('rider'));

drop policy if exists "Admins can read every location consent" on public.rider_location_consent;
create policy "Admins can read every location consent"
  on public.rider_location_consent for select
  using (public.user_has_role('admin'));

-- ----------------------------------------------------------------------------
-- 2. RIDER_LIVE_LOCATION
-- One row per rider: where they are right now. Written only by
-- report_rider_location(), removed by stop_rider_sharing() or the purge.
-- delivery_request_id is the job they reported against (null when sharing
-- without a job). Realtime postgres_changes applies these SELECT policies per
-- subscriber, so the Boss app sees every rider and a rider sees only themself.
-- ----------------------------------------------------------------------------
create table if not exists public.rider_live_location (
  rider_id uuid primary key references public.profiles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  heading double precision,
  speed_mps double precision,
  delivery_request_id uuid references public.delivery_requests(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.rider_live_location enable row level security;

-- select only (own + admin). Writes go through section 5/6's functions.
revoke all on public.rider_live_location from anon, authenticated;
grant select on public.rider_live_location to authenticated;

drop policy if exists "Riders can read their own live location" on public.rider_live_location;
create policy "Riders can read their own live location"
  on public.rider_live_location for select
  using (auth.uid() = rider_id);

drop policy if exists "Admins can read every live location" on public.rider_live_location;
create policy "Admins can read every live location"
  on public.rider_live_location for select
  using (public.user_has_role('admin'));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rider_live_location'
  ) then
    execute 'alter publication supabase_realtime add table public.rider_live_location';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. RIDER_LOCATION_POINTS
-- The history: one row per accepted report. order_id is copied from the
-- delivery request at write time, so the trail still answers "where was
-- order X" after the request moves on. Kept for location_retention_months()
-- (section 8), then purged.
-- ----------------------------------------------------------------------------
create table if not exists public.rider_location_points (
  id bigint generated always as identity primary key,
  rider_id uuid not null references public.profiles(id) on delete cascade,
  delivery_request_id uuid references public.delivery_requests(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  recorded_at timestamptz not null default now()
);

create index if not exists rider_location_points_delivery_request_recorded_idx
  on public.rider_location_points (delivery_request_id, recorded_at);
create index if not exists rider_location_points_rider_recorded_idx
  on public.rider_location_points (rider_id, recorded_at);

alter table public.rider_location_points enable row level security;

-- select for admins only. Riders can't read their own trail either.
revoke all on public.rider_location_points from anon, authenticated;
grant select on public.rider_location_points to authenticated;

drop policy if exists "Admins can read every location point" on public.rider_location_points;
create policy "Admins can read every location point"
  on public.rider_location_points for select
  using (public.user_has_role('admin'));

-- ----------------------------------------------------------------------------
-- 4. (no policy for cooks/customers on any of the three tables — by design)
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 5. report_rider_location(): THE RIDER'S APP SENDS A POSITION
-- Refuses (raises) unless ALL of these hold:
--   * the caller is a rider and not blocked (profiles.is_active);
--   * the rider has a rider_location_consent row;
--   * lat/lng are inside Singapore — the same box as quote_delivery
--     (lat 1.1–1.5, lng 103.5–104.1); NaN fails the check too;
--   * if p_delivery_request_id is given: it's this rider's, status
--     'accepted', not completed, and its order isn't cancelled/rejected
--     (same "still active" rule as mark_delivery_picked_up).
-- Then, if this rider's latest point is under 10 seconds old, it returns
-- false and writes nothing. Otherwise it upserts rider_live_location, inserts
-- a rider_location_points row and returns true. Times are the database's
-- now(). accuracy/heading/speed outside sane ranges are stored as null rather
-- than refused (browsers send null/NaN for these routinely).
--
-- A per-rider transaction advisory lock makes two overlapping calls queue, so
-- both can't pass the 10-second check. search_path is '' so every name below
-- is schema-qualified.
-- ----------------------------------------------------------------------------
create or replace function public.report_rider_location(
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision default null,
  p_heading double precision default null,
  p_speed_mps double precision default null,
  p_delivery_request_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_order_id uuid;
  v_last timestamptz;
  v_now timestamptz := now();
  v_accuracy double precision;
  v_heading double precision;
  v_speed double precision;
begin
  if v_uid is null or not public.user_has_role('rider') then
    raise exception 'Only riders can do this.' using errcode = '42501';
  end if;
  if not public.current_user_is_active() then
    raise exception 'Your account is blocked.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.rider_location_consent c where c.rider_id = v_uid) then
    raise exception 'Please agree to location sharing first.' using errcode = '42501';
  end if;

  if p_lat is null or p_lng is null
     or p_lat not between 1.1 and 1.5 or p_lng not between 103.5 and 104.1 then
    raise exception 'That location is outside Singapore.' using errcode = '22023';
  end if;

  if p_delivery_request_id is not null then
    select d.order_id into v_order_id
    from public.delivery_requests d
    join public.orders o on o.id = d.order_id
    where d.id = p_delivery_request_id
      and d.rider_id = v_uid
      and d.status = 'accepted'
      and d.completed_at is null
      and o.order_status not in ('cancelled', 'rejected');

    if not found then
      raise exception 'This delivery is no longer active.' using errcode = 'P0002';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kb-rider-location:' || v_uid::text, 0));

  select p.recorded_at into v_last
  from public.rider_location_points p
  where p.rider_id = v_uid
  order by p.recorded_at desc
  limit 1;

  if v_last is not null and v_now - v_last < interval '10 seconds' then
    return false;
  end if;

  v_accuracy := case when p_accuracy_m >= 0 and p_accuracy_m < 100000 then p_accuracy_m end;
  v_heading := case when p_heading >= 0 and p_heading < 360 then p_heading end;
  v_speed := case when p_speed_mps >= 0 and p_speed_mps < 100 then p_speed_mps end;

  insert into public.rider_live_location
    (rider_id, lat, lng, accuracy_m, heading, speed_mps, delivery_request_id, updated_at)
  values
    (v_uid, p_lat, p_lng, v_accuracy, v_heading, v_speed, p_delivery_request_id, v_now)
  on conflict (rider_id) do update
    set lat = excluded.lat,
        lng = excluded.lng,
        accuracy_m = excluded.accuracy_m,
        heading = excluded.heading,
        speed_mps = excluded.speed_mps,
        delivery_request_id = excluded.delivery_request_id,
        updated_at = excluded.updated_at;

  insert into public.rider_location_points
    (rider_id, delivery_request_id, order_id, lat, lng, accuracy_m, recorded_at)
  values
    (v_uid, p_delivery_request_id, v_order_id, p_lat, p_lng, v_accuracy, v_now);

  return true;
end;
$$;

revoke all on function public.report_rider_location(double precision, double precision, double precision, double precision, double precision, uuid) from public, anon, authenticated;
grant execute on function public.report_rider_location(double precision, double precision, double precision, double precision, double precision, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. stop_rider_sharing(): THE RIDER SWITCHES SHARING OFF
-- Deletes the caller's own live row (history stays until the purge). No role
-- or is_active check on purpose: anyone signed in may remove their own row,
-- including a rider who was just blocked.
-- ----------------------------------------------------------------------------
create or replace function public.stop_rider_sharing()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in.' using errcode = '42501';
  end if;

  delete from public.rider_live_location where rider_id = auth.uid();
end;
$$;

revoke all on function public.stop_rider_sharing() from public, anon, authenticated;
grant execute on function public.stop_rider_sharing() to authenticated;

-- ----------------------------------------------------------------------------
-- 7. record_rider_location_consent(): THE RIDER AGREES
-- Creates the caller's consent row, or updates it (new time + version) when
-- they agree to a newer version. Returns the stored consented_at.
-- ----------------------------------------------------------------------------
create or replace function public.record_rider_location_consent(p_version text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version text := pg_catalog.btrim(p_version);
  v_now timestamptz := now();
begin
  if auth.uid() is null or not public.user_has_role('rider') then
    raise exception 'Only riders can do this.' using errcode = '42501';
  end if;
  if v_version is null or v_version = '' or pg_catalog.length(v_version) > 50 then
    raise exception 'Missing or invalid consent version.' using errcode = '22023';
  end if;

  insert into public.rider_location_consent (rider_id, consented_at, consent_version)
  values (auth.uid(), v_now, v_version)
  on conflict (rider_id) do update
    set consented_at = excluded.consented_at,
        consent_version = excluded.consent_version;

  return v_now;
end;
$$;

revoke all on function public.record_rider_location_consent(text) from public, anon, authenticated;
grant execute on function public.record_rider_location_consent(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. RETENTION + DAILY PURGE
-- location_retention_months() is the single source for how long the history
-- is kept. purge_rider_locations() deletes points older than that, and live
-- rows not updated for 15 minutes (a rider whose app died without calling
-- stop_rider_sharing). Not callable from the app — pg_cron runs it.
--
-- pg_cron runs in UTC: '15 19 * * *' = 19:15 UTC = 03:15 SGT. Scheduling is
-- idempotent: any existing 'kb-purge-rider-locations' job is unscheduled
-- first. If pg_cron isn't enabled, this only raises a notice (same as
-- kb-notification-reminders in supabase-notifications.sql) — enable it in
-- Dashboard > Database > Extensions and re-run this file.
-- ----------------------------------------------------------------------------
create or replace function public.location_retention_months()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 12;
$$;

revoke all on function public.location_retention_months() from public, anon, authenticated;
grant execute on function public.location_retention_months() to authenticated;

create or replace function public.purge_rider_locations()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.rider_location_points
  where recorded_at < now() - pg_catalog.make_interval(months => public.location_retention_months());

  delete from public.rider_live_location
  where updated_at < now() - interval '15 minutes';
end;
$$;

revoke all on function public.purge_rider_locations() from public, anon, authenticated;

do $$
begin
  create extension if not exists pg_cron;
  if exists (select 1 from cron.job where jobname = 'kb-purge-rider-locations') then
    perform cron.unschedule('kb-purge-rider-locations');
  end if;
  perform cron.schedule(
    'kb-purge-rider-locations',
    '15 19 * * *',
    'select public.purge_rider_locations()'
  );
exception when others then
  raise notice 'pg_cron not available (%). Rider location purge is OFF until it is enabled — re-run this file after enabling it.', sqlerrm;
end $$;

-- ----------------------------------------------------------------------------
-- 9. VERIFY (read-only; run in the SQL Editor after this file)
--
-- Tables + RLS on:
--   select c.relname, c.relrowsecurity
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public'
--     and c.relname in ('rider_location_consent', 'rider_live_location', 'rider_location_points');
--   -- expect 3 rows, all relrowsecurity = true
--
-- Policies (expect: consent = own select, own insert, admin select;
-- live = own select, admin select; points = admin select only):
--   select tablename, policyname, cmd
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('rider_location_consent', 'rider_live_location', 'rider_location_points')
--   order by tablename, policyname;
--
-- Grants (expect authenticated: SELECT on all three, INSERT only as a column
-- grant on consent; anon: nothing):
--   select table_name, grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public'
--     and table_name in ('rider_location_consent', 'rider_live_location', 'rider_location_points')
--     and grantee in ('anon', 'authenticated')
--   order by table_name, grantee, privilege_type;
--   select table_name, column_name, grantee, privilege_type
--   from information_schema.column_privileges
--   where table_schema = 'public' and table_name = 'rider_location_consent'
--     and grantee = 'authenticated' and privilege_type = 'INSERT';
--
-- Realtime (expect 1 row):
--   select * from pg_publication_tables
--   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rider_live_location';
--
-- Functions: SECURITY DEFINER, search_path='', execute for authenticated only
-- (purge_rider_locations: no grants at all):
--   select p.oid::regprocedure as signature, p.prosecdef, p.proconfig, p.proacl
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('report_rider_location', 'stop_rider_sharing',
--                       'record_rider_location_consent', 'location_retention_months',
--                       'purge_rider_locations');
--
-- Cron job (expect exactly 1 row, schedule '15 19 * * *'):
--   select jobid, jobname, schedule, command, active
--   from cron.job where jobname = 'kb-purge-rider-locations';
-- Its recent runs:
--   select status, return_message, start_time
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'kb-purge-rider-locations')
--   order by start_time desc limit 5;
--
-- ----------------------------------------------------------------------------
-- MANUAL TEST (SQL Editor; everything rolls back)
-- Replace <RIDER_UUID> with an active rider's profiles.id, <JOB_UUID> with a
-- delivery_requests.id that rider has 'accepted', and <OTHER_JOB_UUID> with
-- one they don't. Each block impersonates the rider via the JWT claim that
-- auth.uid() reads.
--
--   begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub', '<RIDER_UUID>', 'role', 'authenticated')::text, true);
--   set local role authenticated;
--
--   -- before consent -> "Please agree to location sharing first." (run alone,
--   -- it aborts the transaction):
--   -- select public.report_rider_location(1.3521, 103.8198, 10, 90, 4, null);
--
--   select public.record_rider_location_consent('v1');                 -- a timestamp
--   select * from public.rider_location_consent;                        -- 1 row: own
--   select public.report_rider_location(1.3521, 103.8198, 12, 90, 4.2, '<JOB_UUID>');  -- true
--   select public.report_rider_location(1.3530, 103.8200, 12, 90, 4.2, '<JOB_UUID>');  -- false (under 10 s)
--   select * from public.rider_live_location;                           -- 1 row: own, first point
--   select count(*) from public.rider_location_points;                  -- 0 (riders can't read history)
--   select public.stop_rider_sharing();
--   select * from public.rider_live_location;                           -- 0 rows
--   rollback;
--
-- Each of these, in its own begin/impersonate/rollback block, must raise:
--   select public.report_rider_location(51.5, -0.12, null, null, null, null);              -- outside Singapore
--   select public.report_rider_location(1.35, 103.82, null, null, null, '<OTHER_JOB_UUID>'); -- no longer active
--   insert into public.rider_location_points (rider_id, lat, lng) values ('<RIDER_UUID>', 1.35, 103.82); -- permission denied
--   update public.rider_live_location set lat = 1.3;                    -- permission denied
--   (as a cook or customer uuid) select public.report_rider_location(1.35, 103.82, null, null, null, null); -- Only riders
--   (as a cook or customer uuid) select * from public.rider_live_location;   -- 0 rows
--
-- As an admin uuid, the same selects return every rider's rows. To check the
-- purge without waiting for 03:15 SGT (as the SQL Editor's own role):
--   begin;
--   update public.rider_live_location set updated_at = now() - interval '16 minutes';
--   select public.purge_rider_locations();
--   select count(*) from public.rider_live_location;   -- 0
--   rollback;
-- ----------------------------------------------------------------------------

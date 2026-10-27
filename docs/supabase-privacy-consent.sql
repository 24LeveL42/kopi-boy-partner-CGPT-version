-- KOPI BOY PARTNER — Privacy Policy acknowledgement on cook and rider
-- applications, the rider's optional GPS consent, and a fix that stops an
-- applicant approving their own application.
--
-- DO NOT RUN UNTIL THE APP IS DEPLOYED.
-- The Partner app's ApplyForm goes out first: it asks for the tick box and
-- sends privacy_policy_version (and gps_consent for riders). Until this file
-- runs those columns don't exist, so the app sends the application again
-- without them and sign-ups keep working. Once this file runs, the database
-- itself refuses an application without the acknowledgement.
--
-- What it adds:
--   1. Columns:
--        cook_applications:  privacy_policy_version, privacy_acknowledged_at
--        rider_applications: privacy_policy_version, privacy_acknowledged_at,
--                            gps_consent (default false), gps_consent_at
--   2. A BEFORE INSERT OR UPDATE trigger on each table that
--        * on INSERT from the app (current_user anon/authenticated and not an
--          admin): forces status = 'pending', reviewed_by = null,
--          reviewed_at = null, and refuses the row without a
--          privacy_policy_version;
--        * on every INSERT: stamps privacy_acknowledged_at and
--          gps_consent_at with the database's now() (whatever the client
--          sent is ignored); gps_consent_at only when gps_consent is true;
--        * on every UPDATE: keeps the consent columns as they were, so an
--          admin's review (or anyone else) can't rewrite a consent record.
--      service_role, postgres and admins are not forced to 'pending' and are
--      not required to send a version (HQ/server paths keep working).
--
-- WHY THE STATUS FIX: the insert policies only check user_id, and
-- after_cook_application_approved / after_rider_application_approved
-- (schema section 35) promote profiles.role on INSERT when status =
-- 'approved'. Without this trigger a hand-made insert with status 'approved'
-- would make its sender a cook or rider. BEFORE triggers run before that
-- AFTER trigger looks at the row, so it now sees 'pending'.
--
-- Who can read the new columns: unchanged — the existing policies give the
-- applicant their own rows and admins every row. No other personal data is
-- collected.
--
-- The GPS answer is only a record. Tracking still needs the rider's per-job
-- consent (rider_location_consent, docs/supabase-rider-tracking.sql).
--
-- Existing applications are untouched (the trigger checks inserts only; old
-- rows keep null consent columns and gps_consent = false).
--
-- Safe to run again: add column if not exists, create or replace, drop
-- trigger if exists. Every name is schema-qualified and search_path = ''.


-- ############################################################################
-- 1. COLUMNS
-- ############################################################################

alter table public.cook_applications add column if not exists privacy_policy_version text;
alter table public.cook_applications add column if not exists privacy_acknowledged_at timestamptz;

alter table public.rider_applications add column if not exists privacy_policy_version text;
alter table public.rider_applications add column if not exists privacy_acknowledged_at timestamptz;
alter table public.rider_applications add column if not exists gps_consent boolean not null default false;
alter table public.rider_applications add column if not exists gps_consent_at timestamptz;


-- ############################################################################
-- 2. GUARD TRIGGERS
-- SECURITY INVOKER (the default), so current_user is the caller's role:
-- 'authenticated' for the app, 'service_role' / 'postgres' for server paths.
-- public.user_has_role is SECURITY DEFINER and already used by every policy.
-- ############################################################################

create or replace function public.guard_cook_application()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_from_app boolean := current_user in ('anon', 'authenticated') and not public.user_has_role('admin');
begin
  if tg_op = 'UPDATE' then
    new.privacy_policy_version := old.privacy_policy_version;
    new.privacy_acknowledged_at := old.privacy_acknowledged_at;
    return new;
  end if;

  if v_from_app then
    new.status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;

  new.privacy_policy_version := nullif(btrim(coalesce(new.privacy_policy_version, '')), '');
  if new.privacy_policy_version is not null and new.privacy_policy_version !~ '^[0-9A-Za-z._-]{1,32}$' then
    raise exception 'Please tick the Privacy Policy acknowledgement before submitting.' using errcode = '23514';
  end if;
  if new.privacy_policy_version is null and v_from_app then
    raise exception 'Please tick the Privacy Policy acknowledgement before submitting.' using errcode = '23514';
  end if;
  new.privacy_acknowledged_at := case when new.privacy_policy_version is not null then now() end;

  return new;
end;
$$;

revoke all on function public.guard_cook_application() from public, anon, authenticated;

drop trigger if exists before_cook_application_guard on public.cook_applications;
create trigger before_cook_application_guard
  before insert or update on public.cook_applications
  for each row execute function public.guard_cook_application();


create or replace function public.guard_rider_application()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_from_app boolean := current_user in ('anon', 'authenticated') and not public.user_has_role('admin');
begin
  if tg_op = 'UPDATE' then
    new.privacy_policy_version := old.privacy_policy_version;
    new.privacy_acknowledged_at := old.privacy_acknowledged_at;
    new.gps_consent := old.gps_consent;
    new.gps_consent_at := old.gps_consent_at;
    return new;
  end if;

  if v_from_app then
    new.status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;

  new.privacy_policy_version := nullif(btrim(coalesce(new.privacy_policy_version, '')), '');
  if new.privacy_policy_version is not null and new.privacy_policy_version !~ '^[0-9A-Za-z._-]{1,32}$' then
    raise exception 'Please tick the Privacy Policy acknowledgement before submitting.' using errcode = '23514';
  end if;
  if new.privacy_policy_version is null and v_from_app then
    raise exception 'Please tick the Privacy Policy acknowledgement before submitting.' using errcode = '23514';
  end if;
  new.privacy_acknowledged_at := case when new.privacy_policy_version is not null then now() end;

  -- Optional, unticked by default: only an explicit true counts.
  new.gps_consent := coalesce(new.gps_consent, false);
  new.gps_consent_at := case when new.gps_consent then now() end;

  return new;
end;
$$;

revoke all on function public.guard_rider_application() from public, anon, authenticated;

drop trigger if exists before_rider_application_guard on public.rider_applications;
create trigger before_rider_application_guard
  before insert or update on public.rider_applications
  for each row execute function public.guard_rider_application();


-- ############################################################################
-- HOW TO CHECK (read-only unless noted)
-- ############################################################################
--
-- Columns are there:
--   select table_name, column_name, data_type, column_default
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name in ('cook_applications', 'rider_applications')
--     and column_name in ('privacy_policy_version', 'privacy_acknowledged_at', 'gps_consent', 'gps_consent_at')
--   order by table_name, column_name;
--
-- Triggers are there:
--   select tgrelid::regclass, tgname from pg_trigger
--   where tgname in ('before_cook_application_guard', 'before_rider_application_guard');
--
-- From the app (signed in as a test account with no application):
--   * Submit without ticking: blocked in the form. A hand-made insert without
--     privacy_policy_version: "Please tick the Privacy Policy
--     acknowledgement before submitting."
--   * A hand-made insert with status 'approved': the row is stored as
--     'pending' and profiles.role stays 'customer'.
--   * After a normal submit (as admin in the SQL editor):
--       select status, privacy_policy_version, privacy_acknowledged_at
--       from public.cook_applications order by created_at desc limit 1;
--       select status, privacy_policy_version, privacy_acknowledged_at, gps_consent, gps_consent_at
--       from public.rider_applications order by created_at desc limit 1;
--     privacy_acknowledged_at is the database's time; gps_consent_at is set
--     only when gps_consent is true.

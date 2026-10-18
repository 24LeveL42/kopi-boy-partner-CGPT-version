-- ============================================================================
-- KOPI BOY 2.0 — "I've collected the food": picked-up step for deliveries
-- Run this in the Supabase SQL Editor AFTER docs/supabase-schema.sql,
-- docs/supabase-messages.sql (complete_delivery_with_proof) and
-- docs/supabase-admin-messages.sql (current_user_is_active). Run the Customer
-- app's docs/supabase-customer-push.sql too if you want the customer push —
-- this file works without it, the push just isn't sent until it exists.
-- Safe to re-run.
--
-- A delivery now goes: accepted -> picked up -> delivered.
--
-- Where it lives: delivery_requests.picked_up_at, NOT a new status value.
-- status stays 'accepted' while the rider carries the food, so everything
-- that keys off 'accepted' (order chat, partner-rider chat, live location,
-- get_delivery_kitchen_location, get_delivery_order_details, the Customer
-- app's get_order_rider) keeps working through the whole trip. "Picked up" =
-- status 'accepted' AND picked_up_at is not null.
--
-- What it adds:
--   1. delivery_requests.picked_up_at.
--   2. mark_delivery_picked_up(request_id): the only way a rider sets it.
--   3. A guard trigger: picked_up_at can't be set any other way (no PATCH
--      with a made-up time), and the rider can't complete before picking up.
--   4. A push to the Customer app on the pickup, event 'order_picked_up'.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE COLUMN
-- No new GRANT/RLS: the table-level `grant select, insert, update on
-- public.delivery_requests to authenticated` covers it, and cooks/riders
-- already read their own rows. Writes are locked down by section 3.
-- ----------------------------------------------------------------------------
alter table public.delivery_requests add column if not exists picked_up_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2. mark_delivery_picked_up(): THE RIDER SAYS "I'VE COLLECTED THE FOOD"
-- Refuses unless ALL of these hold, otherwise raises with a plain message:
--   * the caller is a rider and not blocked (profiles.is_active);
--   * the caller is the rider assigned to this delivery, and it's 'accepted'
--     (so not open, released, delivered or cancelled);
--   * the order itself isn't cancelled/rejected;
--   * it hasn't already been marked picked up (not twice).
-- The time is the database's now(), never a client-supplied value.
--
-- SECURITY DEFINER because riders can't read public.orders (to check it isn't
-- cancelled). Every check above is explicit, and the row is locked FOR UPDATE
-- so two taps can't both pass the "not twice" check. The transaction-local
-- flag is what section 3's guard accepts; set_config isn't reachable through
-- PostgREST, so nothing else can set it (same pattern as
-- complete_delivery_with_proof's kopiboy.delivery_proof).
-- ----------------------------------------------------------------------------
create or replace function public.mark_delivery_picked_up(p_request_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  v_order_status text;
  v_now timestamptz := now();
begin
  if auth.uid() is null or not public.user_has_role('rider') then
    raise exception 'Only riders can do this.' using errcode = '42501';
  end if;
  if not public.current_user_is_active() then
    raise exception 'Your account is blocked.' using errcode = '42501';
  end if;

  select id, order_id, rider_id, status, picked_up_at into d
  from public.delivery_requests
  where id = p_request_id
  for update;

  if not found or d.rider_id is distinct from auth.uid() or d.status <> 'accepted' then
    raise exception 'This delivery is no longer active.' using errcode = 'P0002';
  end if;

  select o.order_status into v_order_status from public.orders o where o.id = d.order_id;
  if v_order_status in ('cancelled', 'rejected') then
    raise exception 'This order was cancelled — no need to collect it.' using errcode = '42501';
  end if;

  if d.picked_up_at is not null then
    raise exception 'You''ve already marked this food as collected.' using errcode = '23505';
  end if;

  perform set_config('kopiboy.delivery_pickup', p_request_id::text, true);

  update public.delivery_requests
  set picked_up_at = v_now
  where id = p_request_id;

  return v_now;
end;
$$;

revoke all on function public.mark_delivery_picked_up(uuid) from public, anon, authenticated;
grant execute on function public.mark_delivery_picked_up(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. GUARD: ORDER OF STATES
-- Fires on every UPDATE of delivery_requests:
--   * Back to 'open' (a re-opened job, e.g. after a release): picked_up_at is
--     cleared, so the next rider collects again.
--   * picked_up_at changing any other way than through section 2 is refused —
--     except for admins (corrections) and the SQL Editor / service role
--     (auth.uid() is null).
--   * The assigned rider can't move the job to 'completed' while
--     picked_up_at is null: "Collect the food first". Rider completion goes
--     through complete_delivery_with_proof, whose UPDATE passes through here.
--     Admin / cook updates are unaffected, as with require_delivery_proof.
-- Jobs already accepted before this ran simply show "I've collected the food"
-- first; none get stuck.
-- ----------------------------------------------------------------------------
create or replace function public.guard_delivery_pickup()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'open' and old.status is distinct from 'open' then
    new.picked_up_at := null;
    return new;
  end if;

  if auth.uid() is null or public.user_has_role('admin') then
    return new;
  end if;

  if new.picked_up_at is distinct from old.picked_up_at
     and coalesce(current_setting('kopiboy.delivery_pickup', true), '') <> new.id::text then
    raise exception 'Use "I''ve collected the food" to mark a pickup.' using errcode = '42501';
  end if;

  if new.status = 'completed'
     and old.status is distinct from 'completed'
     and new.rider_id = auth.uid()
     and new.picked_up_at is null then
    raise exception 'Collect the food first, then mark it delivered.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_delivery_pickup on public.delivery_requests;
create trigger guard_delivery_pickup
  before update on public.delivery_requests
  for each row execute function public.guard_delivery_pickup();

-- ----------------------------------------------------------------------------
-- 4. PUSH TO THE CUSTOMER APP: event 'order_picked_up'
-- The Customer app's own trigger (private.customer_push_on_delivery_change,
-- docs/supabase-customer-push.sql in that repo) only watches `status`, and
-- picked_up_at doesn't change it. Rather than `create or replace` that
-- function from here (two repos overwriting one function, whichever ran
-- last), this is a separate trigger that calls the Customer app's sender,
-- private.send_customer_order_push(order_id, event, ref), the same way:
--   body = { order_id, event: 'order_picked_up', ref: <rider id> }
-- ref = the rider, like rider_on_the_way, so a new rider collecting after a
-- release is a new push but the same pickup is never sent twice (the Customer
-- route's dedupe key is order_id:event:ref).
--
-- If the Customer push SQL hasn't been run, the sender doesn't exist yet; the
-- exception block turns that (and any other push failure) into a WARNING, so
-- the rider's pickup is never rolled back.
-- ----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.customer_push_on_delivery_pickup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.picked_up_at is not null and old.picked_up_at is null then
    perform private.send_customer_order_push(new.order_id, 'order_picked_up', new.rider_id::text);
  end if;
  return null;
exception when others then
  raise warning 'customer_push_on_delivery_pickup failed: %', sqlerrm;
  return null;
end;
$$;

revoke all on function private.customer_push_on_delivery_pickup() from public, anon, authenticated;

drop trigger if exists customer_push_on_delivery_pickup on public.delivery_requests;
create trigger customer_push_on_delivery_pickup
  after update of picked_up_at on public.delivery_requests
  for each row execute function private.customer_push_on_delivery_pickup();

-- ----------------------------------------------------------------------------
-- HOW TO CHECK IT'S WORKING
--   * As the assigned rider: rpc mark_delivery_picked_up -> picked_up_at set;
--     a second call -> "You've already marked this food as collected.";
--     another rider, or a blocked rider -> refused.
--   * As the rider, a direct PATCH of picked_up_at -> refused; completing
--     before picking up -> "Collect the food first, then mark it delivered."
--   * Customer push: after a pickup,
--       select id, status_code, left(content, 160) as response
--       from net._http_response order by created desc limit 5;
--     400 "Unknown order or event" = the Customer route doesn't know
--     'order_picked_up' yet (expected until that app is updated).
-- ----------------------------------------------------------------------------

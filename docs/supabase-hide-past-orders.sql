-- ============================================================================
-- KOPI BOY 2.0 — "Remove from my list" for past orders (cooks and riders)
-- Run this in the Supabase SQL Editor AFTER docs/supabase-schema.sql,
-- docs/supabase-admin-messages.sql (current_user_is_active) and
-- docs/supabase-delivery-pickup.sql. Safe to re-run.
--
-- Finished orders pile up on the cook's order screen and the rider's jobs
-- screen. The Partner app now shows them under a collapsed "Past orders"
-- section, and each cook or rider can remove one (or all) from THEIR list.
--
-- NOTHING IS DELETED. Hiding is a timestamp, one per role, on the row that
-- role owns:
--   * orders.cook_hidden_at             — the cook hid it from their order screen
--   * delivery_requests.rider_hidden_at — the rider hid it from their jobs screen
-- A cook hiding an order never touches delivery_requests, and a rider hiding
-- a job never touches orders, so neither hides anything for the other, for
-- the customer or for Boss admin. Only the Partner app's two lists filter on
-- these columns; earnings, counts, reports and every other reader of order
-- history (Customer app, Boss app, notifications, "Completed today") ignore
-- them and still see every row.
--
-- What it adds:
--   1. The two columns.
--   2. hide_cook_order(order_id) / hide_all_cook_past_orders():
--      the only way a cook sets cook_hidden_at.
--   3. hide_rider_job(request_id) / hide_all_rider_past_jobs():
--      the only way a rider sets rider_hidden_at.
--   4. Guard triggers: the columns can't be set or cleared any other way.
--      The existing broad UPDATE policies ("Cooks can update orders placed at
--      their kitchen", "Riders can complete their assigned delivery request")
--      would otherwise let a direct PATCH write them, and the INSERT policies
--      would let a new row arrive already hidden.
--
-- What "finished" means (keep in sync with src/lib/past-orders.ts):
--   * Cook: order_status 'cancelled' or 'rejected'; or 'accepted', PAID, with
--     a completed (delivered) delivery request. A delivered order the cook
--     hasn't marked paid still needs attention, so it stays active.
--   * Rider: their own delivery request with status 'completed' or 'cancelled'.
--
-- The functions are SECURITY DEFINER (like mark_delivery_picked_up) because
-- the cook check reads delivery_requests and the guard flag must be set in
-- the same transaction as the UPDATE. Every check is explicit: role, not
-- blocked (profiles.is_active), ownership, finished. The transaction-local
-- flag they set is what the section 4 guards accept; set_config isn't
-- reachable through PostgREST, so nothing else can set it.
--
-- Undoing a hide (no button for it in the app): run as the SQL Editor, e.g.
--   update public.orders set cook_hidden_at = null where id = '<order id>';
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE COLUMNS
-- No new GRANT/RLS: the table-level grants on orders / delivery_requests
-- cover them, and cooks/riders already read their own rows. Writes are
-- locked down by section 4.
-- ----------------------------------------------------------------------------
alter table public.orders add column if not exists cook_hidden_at timestamptz;
alter table public.delivery_requests add column if not exists rider_hidden_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2. COOK: hide_cook_order() and hide_all_cook_past_orders()
-- hide_cook_order refuses (plain message) unless the caller is an active cook,
-- the order is at their kitchen, and it's finished. Hiding an already hidden
-- order is a no-op. hide_all_cook_past_orders hides every finished, not yet
-- hidden order at the caller's kitchen and returns how many.
-- ----------------------------------------------------------------------------
create or replace function public.hide_cook_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  o record;
begin
  if v_uid is null or not public.user_has_role('cook') then
    raise exception 'Only cooks can do this.' using errcode = '42501';
  end if;
  if not public.current_user_is_active() then
    raise exception 'Your account is blocked.' using errcode = '42501';
  end if;

  select id, kitchen_id, order_status, payment_status, cook_hidden_at into o
  from public.orders
  where id = p_order_id
  for update;

  if not found or o.kitchen_id is distinct from v_uid then
    raise exception 'This order isn''t at your kitchen.' using errcode = 'P0002';
  end if;

  if not (
    o.order_status in ('cancelled', 'rejected')
    or (
      o.order_status = 'accepted'
      and o.payment_status = 'paid'
      and exists (select 1 from public.delivery_requests d where d.order_id = o.id and d.status = 'completed')
    )
  ) then
    raise exception 'Only finished orders can be removed from your list.' using errcode = '42501';
  end if;

  if o.cook_hidden_at is not null then
    return;
  end if;

  perform set_config('kopiboy.cook_hide', v_uid::text, true);
  update public.orders set cook_hidden_at = now() where id = p_order_id;
  perform set_config('kopiboy.cook_hide', '', true);
end;
$$;

create or replace function public.hide_all_cook_past_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null or not public.user_has_role('cook') then
    raise exception 'Only cooks can do this.' using errcode = '42501';
  end if;
  if not public.current_user_is_active() then
    raise exception 'Your account is blocked.' using errcode = '42501';
  end if;

  perform set_config('kopiboy.cook_hide', v_uid::text, true);
  update public.orders o
  set cook_hidden_at = now()
  where o.kitchen_id = v_uid
    and o.cook_hidden_at is null
    and (
      o.order_status in ('cancelled', 'rejected')
      or (
        o.order_status = 'accepted'
        and o.payment_status = 'paid'
        and exists (select 1 from public.delivery_requests d where d.order_id = o.id and d.status = 'completed')
      )
    );
  get diagnostics v_count = row_count;
  perform set_config('kopiboy.cook_hide', '', true);
  return v_count;
end;
$$;

revoke all on function public.hide_cook_order(uuid) from public, anon, authenticated;
grant execute on function public.hide_cook_order(uuid) to authenticated;
revoke all on function public.hide_all_cook_past_orders() from public, anon, authenticated;
grant execute on function public.hide_all_cook_past_orders() to authenticated;

-- ----------------------------------------------------------------------------
-- 3. RIDER: hide_rider_job() and hide_all_rider_past_jobs()
-- Same shape as section 2: an active rider, the job assigned to them, and
-- finished (completed or cancelled). A job released back to 'open' no longer
-- has this rider on it, so it isn't theirs to hide.
-- ----------------------------------------------------------------------------
create or replace function public.hide_rider_job(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  d record;
begin
  if v_uid is null or not public.user_has_role('rider') then
    raise exception 'Only riders can do this.' using errcode = '42501';
  end if;
  if not public.current_user_is_active() then
    raise exception 'Your account is blocked.' using errcode = '42501';
  end if;

  select id, rider_id, status, rider_hidden_at into d
  from public.delivery_requests
  where id = p_request_id
  for update;

  if not found or d.rider_id is distinct from v_uid then
    raise exception 'This job isn''t yours.' using errcode = 'P0002';
  end if;

  if d.status not in ('completed', 'cancelled') then
    raise exception 'Only finished jobs can be removed from your list.' using errcode = '42501';
  end if;

  if d.rider_hidden_at is not null then
    return;
  end if;

  perform set_config('kopiboy.rider_hide', v_uid::text, true);
  update public.delivery_requests set rider_hidden_at = now() where id = p_request_id;
  perform set_config('kopiboy.rider_hide', '', true);
end;
$$;

create or replace function public.hide_all_rider_past_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null or not public.user_has_role('rider') then
    raise exception 'Only riders can do this.' using errcode = '42501';
  end if;
  if not public.current_user_is_active() then
    raise exception 'Your account is blocked.' using errcode = '42501';
  end if;

  perform set_config('kopiboy.rider_hide', v_uid::text, true);
  update public.delivery_requests
  set rider_hidden_at = now()
  where rider_id = v_uid
    and rider_hidden_at is null
    and status in ('completed', 'cancelled');
  get diagnostics v_count = row_count;
  perform set_config('kopiboy.rider_hide', '', true);
  return v_count;
end;
$$;

revoke all on function public.hide_rider_job(uuid) from public, anon, authenticated;
grant execute on function public.hide_rider_job(uuid) to authenticated;
revoke all on function public.hide_all_rider_past_jobs() from public, anon, authenticated;
grant execute on function public.hide_all_rider_past_jobs() to authenticated;

-- ----------------------------------------------------------------------------
-- 4. GUARDS: THE COLUMNS ONLY CHANGE THROUGH SECTIONS 2 AND 3
--   * INSERT: a new row never starts hidden (a customer placing an order, or
--     a cook requesting a rider, can't pre-hide it for the other side).
--   * UPDATE: the column may only go from null to a time, only for the
--     owner named in the flag (the kitchen for orders, the assigned rider for
--     delivery requests). No un-hiding, no re-stamping, no PATCH.
--   * The SQL Editor / service role (auth.uid() is null) is exempt, for
--     corrections. Admins are NOT exempt: these are the partner's own list
--     settings, and Boss never needs to write them.
-- The other delivery_requests triggers don't get in the way: the hide only
-- touches completed/cancelled rows, which guard_blocked_rider_delivery_update
-- skips, and it doesn't change status or picked_up_at, which
-- require_delivery_proof / guard_delivery_pickup / the notification triggers
-- watch. notify_on_order_change only fires on order_status.
-- ----------------------------------------------------------------------------
create or replace function public.guard_cook_hidden_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.cook_hidden_at := null;
    return new;
  end if;

  if new.cook_hidden_at is distinct from old.cook_hidden_at
     and not (
       old.cook_hidden_at is null
       and new.cook_hidden_at is not null
       and coalesce(current_setting('kopiboy.cook_hide', true), '') = new.kitchen_id::text
     ) then
    raise exception 'Use "Remove from my list" to hide an order.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_cook_hidden_at() from public, anon, authenticated;

drop trigger if exists guard_cook_hidden_at on public.orders;
create trigger guard_cook_hidden_at
  before insert or update on public.orders
  for each row execute function public.guard_cook_hidden_at();

create or replace function public.guard_rider_hidden_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.rider_hidden_at := null;
    return new;
  end if;

  -- Re-opened for another rider: the old rider's hide doesn't carry over.
  if new.status = 'open' and old.status is distinct from 'open' then
    new.rider_hidden_at := null;
    return new;
  end if;

  if new.rider_hidden_at is distinct from old.rider_hidden_at
     and not (
       old.rider_hidden_at is null
       and new.rider_hidden_at is not null
       and new.rider_id is not null
       and coalesce(current_setting('kopiboy.rider_hide', true), '') = new.rider_id::text
     ) then
    raise exception 'Use "Remove from my list" to hide a job.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_rider_hidden_at() from public, anon, authenticated;

drop trigger if exists guard_rider_hidden_at on public.delivery_requests;
create trigger guard_rider_hidden_at
  before insert or update on public.delivery_requests
  for each row execute function public.guard_rider_hidden_at();

-- ----------------------------------------------------------------------------
-- HOW TO CHECK IT'S WORKING
--   * As a cook: rpc hide_cook_order on a delivered+paid, cancelled or
--     rejected order -> cook_hidden_at set; on a placed/accepted (not yet
--     delivered and paid) order -> "Only finished orders can be removed from
--     your list."; on another kitchen's order -> "This order isn't at your
--     kitchen."; while blocked -> "Your account is blocked."
--   * As a cook, a direct PATCH of orders.cook_hidden_at -> refused.
--   * As a rider: the same with hide_rider_job / rider_hidden_at.
--   * The other side is untouched:
--       select o.id, o.cook_hidden_at, d.rider_hidden_at
--       from public.orders o left join public.delivery_requests d on d.order_id = o.id
--       order by o.created_at desc limit 10;
-- ----------------------------------------------------------------------------

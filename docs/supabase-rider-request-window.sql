-- ============================================================================
-- KOPI BOY 2.0 — Scheduled orders: no rider request until 45 minutes before
-- Run this in the Supabase SQL Editor AFTER docs/supabase-schema.sql,
-- docs/supabase-notifications.sql and docs/supabase-order-delivery-details.sql.
-- Safe to re-run.
--
-- Why: inserting an open delivery_requests row is what pings every on-duty
-- rider (notify_on_delivery_change in supabase-notifications.sql). For an
-- order scheduled for tomorrow, a cook who requests a rider tonight would
-- ping riders hours early. This guard refuses the insert until the order is
-- 45 minutes or less from its scheduled time, using the database's clock.
-- The broadcast trigger and push sender are unchanged — the ping simply
-- can't happen early because the row can't exist early.
--
-- The Partner app checks the same rule first (requestRiderAs in
-- src/lib/rider-request.ts, RIDER_REQUEST_LEAD_MINUTES) and disables the
-- button; this trigger is the backstop for a stale page or a direct API call.
-- Keep the 45 minutes in sync with that constant.
--
-- - ASAP orders (scheduled_for is null) are untouched, exactly as before.
-- - Only INSERTs are checked. Nothing re-opens a request by UPDATE before the
--   window (a request can only exist once the window has opened), so the
--   release / re-open flow is unaffected.
-- - SECURITY DEFINER so the check always sees the order row, whatever the
--   caller's RLS — a hidden row must not read as "no scheduled time".
-- ============================================================================

-- Same no-op-if-present line as supabase-order-delivery-details.sql, so the
-- function below can't fail on a database without the column yet.
alter table public.orders add column if not exists scheduled_for timestamptz;

create or replace function public.guard_scheduled_delivery_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opens_at timestamptz;
begin
  select o.scheduled_for - interval '45 minutes' into v_opens_at
  from public.orders o
  where o.id = new.order_id;

  if v_opens_at is not null and now() < v_opens_at then
    -- Same wording as the Partner app's button: "Rider can be requested from 5:30 pm".
    raise exception 'Rider can be requested from %.',
      to_char(v_opens_at at time zone 'Asia/Singapore', 'FMHH12:MI am')
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_scheduled_delivery_request() from public, anon, authenticated;

drop trigger if exists guard_scheduled_delivery_request on public.delivery_requests;
create trigger guard_scheduled_delivery_request
  before insert on public.delivery_requests
  for each row execute function public.guard_scheduled_delivery_request();

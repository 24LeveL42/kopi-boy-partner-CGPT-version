-- ============================================================================
-- KOPI BOY 2.0 — Delivery details (address, unit, notes, Express, scheduled
-- time) for the Partner app's cook and rider screens
-- Run this in the Supabase SQL Editor AFTER docs/supabase-schema.sql and the
-- Customer app's delivery quote / saved addresses migrations. Safe to re-run.
--
-- COOKS need nothing new. The `grant select, insert, update on public.orders
-- to authenticated` in supabase-schema.sql is table-level (no column list),
-- so it covers these columns, and "Cooks can read orders placed at their
-- kitchen" already returns the whole row.
--
-- RIDERS can't read public.orders at all (no policy grants it), so they get
-- the delivery fields from get_delivery_order_details() below — same pattern
-- as get_delivery_kitchen_location() (schema section 30): a SECURITY DEFINER
-- function that checks the caller and returns only what they may see.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE ORDER COLUMNS
-- Owned and written by the Customer app (placeOrder). Repeated here with
-- IF NOT EXISTS only so this file — and the function below — can't fail on a
-- database where one of those migrations hasn't run yet. Each line is a no-op
-- when the column already exists; it never changes a type or constraint.
-- ----------------------------------------------------------------------------
alter table public.orders add column if not exists customer_postal_code text;
alter table public.orders add column if not exists delivery_type text;
alter table public.orders add column if not exists scheduled_for timestamptz; -- null = as soon as possible
alter table public.orders add column if not exists delivery_address_line text;
alter table public.orders add column if not exists delivery_unit text;
alter table public.orders add column if not exists delivery_notes text;

-- ----------------------------------------------------------------------------
-- 2. get_delivery_order_details(): WHAT A RIDER SEES ABOUT THE DROP-OFF
-- Takes a batch of delivery_request ids (the open-jobs feed is one call, not
-- one per card) and returns one row per request the caller may see:
--
--   * an OPEN request, to anyone with the rider role (same rule as the
--     "Riders can read open delivery requests" policy): delivery_type,
--     scheduled_for and the customer's postal SECTOR (first 2 digits) only —
--     no address line, unit, notes or full postal code. Every on-duty rider
--     can see open jobs, so the customer's exact address stays private until
--     someone takes the job, like the kitchen's.
--   * the caller's own ACCEPTED request: all of the above plus the full
--     postal code, address line, unit and notes.
--
-- Anything else (someone else's job, release_requested, completed, cancelled)
-- returns no row, so access ends when the job does. Casts keep the declared
-- return types stable whatever exact types the Customer app used.
--
-- Execute is revoked from PUBLIC *and* anon/authenticated first (Supabase
-- grants those directly on new functions — same note as get_order_rider),
-- then granted back to authenticated only.
-- ----------------------------------------------------------------------------
create or replace function public.get_delivery_order_details(p_delivery_request_ids uuid[])
returns table (
  delivery_request_id uuid,
  delivery_type text,
  scheduled_for timestamptz,
  customer_postal_sector text,
  customer_postal_code text,
  delivery_address_line text,
  delivery_unit text,
  delivery_notes text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.id,
    o.delivery_type::text,
    o.scheduled_for::timestamptz,
    left(o.customer_postal_code::text, 2),
    case when a.mine then o.customer_postal_code::text end,
    case when a.mine then o.delivery_address_line end,
    case when a.mine then o.delivery_unit end,
    case when a.mine then o.delivery_notes end
  from public.delivery_requests d
  join public.orders o on o.id = d.order_id
  cross join lateral (
    select coalesce(d.rider_id = auth.uid() and d.status = 'accepted', false) as mine
  ) a
  where d.id = any(p_delivery_request_ids)
    and (a.mine or (d.status = 'open' and public.user_has_role('rider')));
$$;

revoke all on function public.get_delivery_order_details(uuid[]) from public, anon, authenticated;
grant execute on function public.get_delivery_order_details(uuid[]) to authenticated;

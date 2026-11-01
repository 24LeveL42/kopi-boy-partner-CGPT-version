-- ============================================================================
-- KOPI BOY — Kitchen privacy, Phase 2 (signed-in users)
--
-- Phase 1 (Customer repo, docs/supabase-kitchen-privacy.sql) hid five
-- kitchens columns from signed-out visitors:
--   paynow_type, paynow_value, latitude, longitude, acknowledged_terms_at
-- Any signed-in user (role `authenticated`) could still read them, and anyone
-- can sign up. After this file only the cook who owns the kitchen and admins
-- can read them, through two SECURITY DEFINER functions.
--
-- TWO PARTS, RUN SEPARATELY, IN THIS ORDER:
--   Part A (additive): creates get_my_kitchen_private() and
--     admin_get_kitchen_private(). Changes nothing that exists. Safe any time.
--   Part B (the lock): one transaction. Only after the Partner app that stops
--     using select("*") / upsert on kitchens is live (commit "Kitchen privacy
--     Phase 2"), and Boss and the Customer app are checked (see the plan).
--
-- What stays the same:
--   * INSERT and UPDATE on kitchens for `authenticated` (the cook still saves
--     PayNow and ticks the terms; RLS still limits it to their own row).
--   * get_order_paynow (SECURITY DEFINER), kitchen_public_locations and
--     hero_candidates (security_invoker = false views), quote_delivery
--     (reads kitchen_addresses as SECURITY DEFINER), and the kitchens
--     triggers (sections 27, 29, 33): none of them read as the caller.
--
-- What changes for app code: a signed-in select("*") on kitchens fails with
-- "permission denied" (it names columns the caller can't read), and so does
-- an upsert that sets a private column (ON CONFLICT DO UPDATE ... EXCLUDED
-- needs SELECT on what it sets). Use explicit public columns, and a plain
-- INSERT then UPDATE.
-- ============================================================================


-- ============================================================================
-- PART A — ADDITIVE (run first, on its own)
-- UNDO:
--   drop function if exists public.get_my_kitchen_private();
--   drop function if exists public.admin_get_kitchen_private(uuid);
-- ============================================================================

-- The signed-in cook's own PayNow and terms date. No row for anyone without
-- a kitchen (customers, riders, signed out). Coordinates aren't here: the cook
-- reads their exact location from kitchen_addresses.
create or replace function public.get_my_kitchen_private()
returns table (paynow_type text, paynow_value text, acknowledged_terms_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select k.paynow_type, k.paynow_value, k.acknowledged_terms_at
  from public.kitchens k
  where k.id = auth.uid();
$$;

-- Admins (Boss): every private column for one kitchen, or for every kitchen
-- when p_kitchen_id is null. Anyone else gets an error, not an empty answer.
create or replace function public.admin_get_kitchen_private(p_kitchen_id uuid default null)
returns table (
  kitchen_id uuid,
  paynow_type text,
  paynow_value text,
  latitude numeric,
  longitude numeric,
  acknowledged_terms_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.user_has_role('admin') then
    raise exception 'Only admins can read kitchen private details.' using errcode = '42501';
  end if;

  return query
    select k.id, k.paynow_type, k.paynow_value, k.latitude::numeric, k.longitude::numeric, k.acknowledged_terms_at
    from public.kitchens k
    where p_kitchen_id is null or k.id = p_kitchen_id;
end;
$$;

-- Supabase grants EXECUTE on new functions to anon/authenticated directly,
-- so revoke from them too, then grant back to signed-in users only.
revoke all on function public.get_my_kitchen_private() from public, anon, authenticated;
revoke all on function public.admin_get_kitchen_private(uuid) from public, anon, authenticated;
grant execute on function public.get_my_kitchen_private() to authenticated;
grant execute on function public.admin_get_kitchen_private(uuid) to authenticated;


-- ============================================================================
-- PART B — THE LOCK (run only after Part A and the app changes are live)
-- One transaction: if anything fails, nothing changes. Safe to re-run.
-- UNDO (puts back the old table-wide read for signed-in users):
--   grant select on public.kitchens to authenticated;
-- ============================================================================

begin;

-- B0. Stop if a column is missing (nothing has changed yet at this point).
do $$
declare
  v_missing text;
begin
  select string_agg(c, ', ' order by c) into v_missing
  from unnest(array[
    'id', 'business_name', 'category', 'cuisine_type', 'neighbourhood',
    'description', 'hero_image', 'is_live', 'created_at', 'updated_at',
    'business_uen', 'postal_sector', 'is_halal', 'is_blocked', 'live_since',
    'paynow_type', 'paynow_value', 'latitude', 'longitude', 'acknowledged_terms_at'
  ]) as c
  where not exists (
    select 1 from information_schema.columns ic
    where ic.table_schema = 'public' and ic.table_name = 'kitchens' and ic.column_name = c
  );
  if v_missing is not null then
    raise exception 'kitchen_privacy_phase2: missing kitchens column(s): %. Nothing was changed.', v_missing;
  end if;
end;
$$;

-- B1. The table-wide grant goes, and so does any earlier column-level grant
-- (a table-level REVOKE leaves those in place). Only SELECT: INSERT and
-- UPDATE stay exactly as they are.
revoke select on public.kitchens from authenticated;

do $$
declare
  v_column text;
begin
  for v_column in
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'kitchens'
  loop
    execute format('revoke select (%I) on public.kitchens from authenticated', v_column);
  end loop;
end;
$$;

-- B2. Exactly the public columns, the same 15 as Phase 1 gave anon. RLS still
-- decides which rows (own kitchen, live kitchens, admins).
grant select (
  id,
  business_name,
  category,
  cuisine_type,
  neighbourhood,
  description,
  hero_image,
  is_live,
  created_at,
  updated_at,
  business_uen,
  postal_sector,
  is_halal,
  is_blocked,
  live_since
) on public.kitchens to authenticated;

commit;


-- ============================================================================
-- CHECKS AFTERWARDS (read only). Paste one at a time into the SQL editor.
--
-- 1. authenticated can SELECT exactly the 15 public columns (expect 15 rows,
--    none of paynow_type, paynow_value, latitude, longitude,
--    acknowledged_terms_at):
-- select column_name from information_schema.column_privileges where table_schema = 'public' and table_name = 'kitchens' and grantee = 'authenticated' and privilege_type = 'SELECT' order by column_name;
--
-- 2. INSERT and UPDATE are still there for authenticated (expect INSERT and UPDATE):
-- select privilege_type from information_schema.table_privileges where table_schema = 'public' and table_name = 'kitchens' and grantee = 'authenticated' order by privilege_type;
--
-- 3. No RLS policy anywhere reads one of the 5 columns as the caller (expect no rows):
-- select schemaname, tablename, policyname from pg_policies where coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ '(paynow_type|paynow_value|acknowledged_terms_at|latitude|longitude)' and (tablename = 'kitchens' or coalesce(qual, '') || coalesce(with_check, '') ~ 'kitchens');
--
-- 4. No view that runs as the caller reads one of the 5 kitchens columns (expect no rows):
-- select c.relname as view_name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' and coalesce(array_to_string(c.reloptions, ','), '') ~ 'security_invoker=(true|on)' and pg_get_viewdef(c.oid) ~ 'kitchens' and pg_get_viewdef(c.oid) ~ '(paynow_type|paynow_value|acknowledged_terms_at|latitude|longitude)';
--
-- 5. As a signed-in user (SQL editor):
--   set local role authenticated;
--   select paynow_value from public.kitchens limit 1;    -- permission denied
--   select * from public.kitchens limit 1;               -- permission denied
--   select id, business_name, is_live from public.kitchens limit 1;  -- works
--   reset role;
-- ============================================================================

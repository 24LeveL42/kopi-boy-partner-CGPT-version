-- ============================================================================
-- KOPI BOY 2.0 — Feature #002: Auth + Roles
-- Run this ONCE in your Supabase project's SQL Editor (Dashboard > SQL Editor
-- > New query > paste this whole file > Run).
--
-- Safe to re-run: every statement below is idempotent (CREATE TABLE IF NOT
-- EXISTS, DROP POLICY/TRIGGER IF EXISTS before CREATE, CREATE OR REPLACE for
-- functions, IF EXISTS/IF NOT EXISTS on ALTER statements). Running this whole
-- file again on a database that already has some or all of it is safe.
--
-- GRANTs vs RLS: a table-level GRANT and a row-level policy are two separate
-- gates that BOTH have to pass — a role with zero table-level GRANT gets
-- "permission denied for table X" no matter what its RLS policies allow, and
-- a role with a full GRANT but no matching policy row still sees/changes
-- nothing. New Supabase projects grant ALL PRIVILEGES on every public table
-- to `anon`/`authenticated` by default (via ALTER DEFAULT PRIVILEGES), which
-- is why this file worked for a while without ever mentioning GRANT — but
-- that's an implicit project setting, not something this file enforces, so
-- every table below now has an explicit `grant ... to authenticated`
-- immediately after it enables RLS, listing exactly the operations its own
-- policies actually allow. Keep these two in sync whenever a policy changes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PROFILES
-- One row per authenticated user. Created automatically on signup via the
-- trigger at the bottom of this file — never insert into this table directly
-- from the app.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer', 'cook', 'rider', 'admin')),
  full_name text,
  phone text,
  -- Admin on/off switch for cooks and riders (section 16/21 of the handover
  -- doc — "temporary block", "suspend/reinstate"). Customers and admins are
  -- always active; this only matters for cook/rider rows.
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Policies below only ever select/update (own row, or admin on every row) —
-- no policy allows insert (rows are created only by the security-definer
-- handle_new_user trigger below, which bypasses RLS/grants as its owner) or
-- delete, so authenticated gets exactly select + update, nothing more.
grant select, update on public.profiles to authenticated;

-- Admin-check helper for RLS policies. Must be SECURITY DEFINER: a policy on
-- public.profiles (or any table) that queries public.profiles directly to
-- check the caller's role forces Postgres to re-evaluate profiles' own
-- SELECT policies to answer that query — including this same admin check —
-- which recurses forever ("infinite recursion detected in policy for
-- relation 'profiles'"). A SECURITY DEFINER function runs as its owner
-- (the table owner, who bypasses RLS by default), so the query inside it
-- never re-triggers the policies it's being used from. Every admin/cook/
-- picker role check below must go through this function, never a raw
-- `exists (select 1 from public.profiles ...)`.
create or replace function public.user_has_role(check_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = check_role
  );
$$;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Users can update their own row, but a trigger (below) silently protects
-- role/is_active from being changed by anyone except an admin — otherwise
-- this policy alone would let a user grant themselves admin access.
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "Admins can read every profile" on public.profiles;
create policy "Admins can read every profile"
  on public.profiles for select
  using (public.user_has_role('admin'));

drop policy if exists "Admins can update every profile" on public.profiles;
create policy "Admins can update every profile"
  on public.profiles for update
  using (public.user_has_role('admin'));

-- ----------------------------------------------------------------------------
-- 2. COOK APPLICATIONS
-- Section 20 of the handover doc: register -> submit -> review -> approve/reject.
-- ----------------------------------------------------------------------------
create table if not exists public.cook_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_name text not null,
  business_type text, -- e.g. "Home Cook", "Hawker", "Bakery", "Small Business"
  description text,
  neighbourhood text,
  paynow_uen text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.cook_applications enable row level security;

-- select (own + admin), insert (own), update (admin review) — no delete policy.
grant select, insert, update on public.cook_applications to authenticated;

drop policy if exists "Applicants can read their own cook application" on public.cook_applications;
create policy "Applicants can read their own cook application"
  on public.cook_applications for select
  using (auth.uid() = user_id);

drop policy if exists "Applicants can submit a cook application" on public.cook_applications;
create policy "Applicants can submit a cook application"
  on public.cook_applications for insert
  with check (auth.uid() = user_id);

drop policy if exists "Admins can read every cook application" on public.cook_applications;
create policy "Admins can read every cook application"
  on public.cook_applications for select
  using (public.user_has_role('admin'));

drop policy if exists "Admins can update every cook application" on public.cook_applications;
create policy "Admins can update every cook application"
  on public.cook_applications for update
  using (public.user_has_role('admin'));

-- ----------------------------------------------------------------------------
-- 3. RIDER APPLICATIONS
-- Section 10/21: free registration, but must be approved before accepting
-- deliveries.
-- ----------------------------------------------------------------------------
create table if not exists public.rider_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_type text, -- e.g. "Bicycle", "Motorcycle", "Car"
  license_plate text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.rider_applications enable row level security;

-- select (own + admin), insert (own), update (admin review) — no delete policy.
grant select, insert, update on public.rider_applications to authenticated;

drop policy if exists "Applicants can read their own rider application" on public.rider_applications;
create policy "Applicants can read their own rider application"
  on public.rider_applications for select
  using (auth.uid() = user_id);

drop policy if exists "Applicants can submit a rider application" on public.rider_applications;
create policy "Applicants can submit a rider application"
  on public.rider_applications for insert
  with check (auth.uid() = user_id);

drop policy if exists "Admins can read every rider application" on public.rider_applications;
create policy "Admins can read every rider application"
  on public.rider_applications for select
  using (public.user_has_role('admin'));

drop policy if exists "Admins can update every rider application" on public.rider_applications;
create policy "Admins can update every rider application"
  on public.rider_applications for update
  using (public.user_has_role('admin'));

-- ----------------------------------------------------------------------------
-- 4. AUTO-CREATE A PROFILE ROW ON SIGNUP
-- Runs every time someone signs up (Google or email OTP). Defaults everyone
-- to role = 'customer' — cooks/riders upgrade their own role only via an
-- approved application (handled in application-approval logic later, Feature
-- #003), never by editing their own profile row directly.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 5. PROTECT role AND is_active FROM SELF-EDITING
-- The "Users can update their own profile" policy above allows a user to
-- update their own row (needed for e.g. changing their name/phone) — but
-- without this trigger, that same policy would let a user set their own
-- role to 'admin' or flip their own is_active flag. This trigger silently
-- reverts those two columns to their previous value unless the person
-- making the change is already an admin, or there is no caller at all
-- (SQL editor, service role: auth.uid() is null). Every signed-in or anon
-- request carries a JWT and anon has no UPDATE grant on profiles, so a null
-- auth.uid() only ever means a trusted server context. Keep this function
-- identical across the Partner, Customer and Boss schema files — they share
-- one database, so re-running an older copy silently undoes the others.
-- ----------------------------------------------------------------------------
create or replace function public.protect_profile_privileges()
returns trigger as $$
begin
  if auth.uid() is not null and not public.user_has_role('admin') then
    new.role := old.role;
    new.is_active := old.is_active;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists before_profile_update on public.profiles;
create trigger before_profile_update
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();


-- ============================================================================
-- KOPI BOY 2.0 — Feature #003: Merchant Onboarding (Kitchen + Menu)
-- Run this ONCE, after the Feature #002 script above, in the same Supabase
-- project's SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 6. KITCHENS
-- One row per approved cook — the merchant-facing profile shown in the
-- Customer app marketplace. Created/edited by the cook themselves via the
-- Partner app's kitchen setup screen, not by HQ. id = the cook's own
-- profiles.id (one kitchen per cook).
-- ----------------------------------------------------------------------------
create table if not exists public.kitchens (
  id uuid primary key references public.profiles(id) on delete cascade,
  business_name text not null,
  category text not null check (category in ('home-cook', 'hawker', 'bakery', 'bulk-orders', 'drinks')),
  cuisine_type text not null check (cuisine_type in ('chinese', 'halal', 'indian', 'western')),
  neighbourhood text not null,
  description text,
  hero_image text, -- optional per the handover doc ("a food photo is optional"); Customer app falls back to a category image when null
  is_live boolean not null default false, -- flips true once the cook has saved at least one menu item (enforced in app logic, not here)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.kitchens enable row level security;

-- select (own cook + admin + anyone reading a live kitchen), insert/update
-- (own cook only) — no delete policy (rows only disappear via the
-- profiles-row cascade).
grant select, insert, update on public.kitchens to authenticated;

drop policy if exists "Cooks can read their own kitchen" on public.kitchens;
create policy "Cooks can read their own kitchen"
  on public.kitchens for select
  using (auth.uid() = id);

drop policy if exists "Cooks can insert their own kitchen" on public.kitchens;
create policy "Cooks can insert their own kitchen"
  on public.kitchens for insert
  with check (auth.uid() = id and public.user_has_role('cook'));

drop policy if exists "Cooks can update their own kitchen" on public.kitchens;
create policy "Cooks can update their own kitchen"
  on public.kitchens for update
  using (auth.uid() = id);

drop policy if exists "Anyone can read live kitchens" on public.kitchens;
create policy "Anyone can read live kitchens"
  on public.kitchens for select
  using (is_live = true);

drop policy if exists "Admins can read every kitchen" on public.kitchens;
create policy "Admins can read every kitchen"
  on public.kitchens for select
  using (public.user_has_role('admin'));

-- ----------------------------------------------------------------------------
-- 7. MENU ITEMS
-- Section: "menu items and price tags are mandatory; a food photo is
-- optional." One row per dish. The Partner app replaces all of a kitchen's
-- rows on every save (see KitchenSetupForm) rather than diffing — simplest
-- correct approach for this feature's scope.
-- ----------------------------------------------------------------------------
create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  name text not null,
  price numeric(6,2) not null check (price > 0),
  photo_url text,
  created_at timestamptz not null default now()
);

alter table public.menu_items enable row level security;

-- "for all" (select/insert/update/delete) for the owning cook, plus select
-- for anyone reading a live kitchen's menu. KitchenSetupForm's replace-all
-- save (delete then insert) needs the delete grant, not just select/insert.
grant select, insert, update, delete on public.menu_items to authenticated;

drop policy if exists "Cooks can manage their own menu items" on public.menu_items;
create policy "Cooks can manage their own menu items"
  on public.menu_items for all
  using (auth.uid() = kitchen_id)
  with check (auth.uid() = kitchen_id);

drop policy if exists "Anyone can read menu items of a live kitchen" on public.menu_items;
create policy "Anyone can read menu items of a live kitchen"
  on public.menu_items for select
  using (exists (select 1 from public.kitchens k where k.id = menu_items.kitchen_id and k.is_live = true));

-- ----------------------------------------------------------------------------
-- 8. KEEP updated_at CURRENT ON KITCHENS
-- ----------------------------------------------------------------------------
create or replace function public.touch_kitchen_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists before_kitchen_update on public.kitchens;
create trigger before_kitchen_update
  before update on public.kitchens
  for each row execute function public.touch_kitchen_updated_at();


-- ============================================================================
-- KOPI BOY 2.0 — Picker role (optional pickup helper for riders)
-- Run this ONCE, after the Feature #002 and #003 scripts above, in the same
-- Supabase project's SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 9. ALLOW 'picker' AS A PROFILE ROLE
-- Postgres won't let you edit a check constraint in place, so it's
-- drop-and-recreate. If this fails because your constraint has a different
-- auto-generated name, find it first with:
--   select conname from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'c';
-- ----------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('customer', 'cook', 'rider', 'picker', 'admin'));

-- ----------------------------------------------------------------------------
-- 10. PICKER APPLICATIONS
-- Same register -> submit -> review -> approve/reject pattern as cook/rider
-- applications. Deliberately minimal fields — this role is meant for
-- students/anyone nearby wanting casual pocket money, not a vetted fleet.
-- ----------------------------------------------------------------------------
create table if not exists public.picker_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note text, -- optional: why they want to pick up orders, anything relevant
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.picker_applications enable row level security;

-- select (own + admin), insert (own), update (admin review) — no delete policy.
grant select, insert, update on public.picker_applications to authenticated;

drop policy if exists "Applicants can read their own picker application" on public.picker_applications;
create policy "Applicants can read their own picker application"
  on public.picker_applications for select
  using (auth.uid() = user_id);

drop policy if exists "Applicants can submit a picker application" on public.picker_applications;
create policy "Applicants can submit a picker application"
  on public.picker_applications for insert
  with check (auth.uid() = user_id);

drop policy if exists "Admins can read every picker application" on public.picker_applications;
create policy "Admins can read every picker application"
  on public.picker_applications for select
  using (public.user_has_role('admin'));

drop policy if exists "Admins can update every picker application" on public.picker_applications;
create policy "Admins can update every picker application"
  on public.picker_applications for update
  using (public.user_has_role('admin'));

-- ----------------------------------------------------------------------------
-- 11. PICKUP REQUESTS
-- The rider-initiated, picker-fulfilled handshake described in the picker
-- workflow: rider requests a picker for a specific kitchen pickup -> any
-- approved picker can accept -> picker collects from the cook -> picker
-- hands off to the rider and marks it complete. Payment (rider pays picker)
-- happens off-platform, same as every other money leg in Kopi Boy —
-- suggested_fee is a default the app shows, not an enforced amount.
--
-- NOTE: not yet linked to a real orders/deliveries table since #005/#006/#008
-- haven't shipped. kitchen_id is enough to make the full accept/collect/
-- handoff loop testable now; link it to a real delivery_id once that table
-- exists.
-- ----------------------------------------------------------------------------
create table if not exists public.pickup_requests (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.profiles(id) on delete cascade,
  kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  picker_id uuid references public.profiles(id),
  status text not null default 'open' check (status in ('open', 'accepted', 'completed', 'cancelled')),
  suggested_fee numeric(5,2) not null default 2.00,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz
);

alter table public.pickup_requests enable row level security;

-- select (rider own, picker open/assigned, admin), insert (rider own),
-- update (rider cancel, picker accept/complete, admin) — no delete policy.
grant select, insert, update on public.pickup_requests to authenticated;

drop policy if exists "Riders can create their own pickup requests" on public.pickup_requests;
create policy "Riders can create their own pickup requests"
  on public.pickup_requests for insert
  with check (auth.uid() = rider_id);

drop policy if exists "Riders can read their own pickup requests" on public.pickup_requests;
create policy "Riders can read their own pickup requests"
  on public.pickup_requests for select
  using (auth.uid() = rider_id);

drop policy if exists "Riders can cancel their own open pickup requests" on public.pickup_requests;
create policy "Riders can cancel their own open pickup requests"
  on public.pickup_requests for update
  using (auth.uid() = rider_id and status = 'open')
  with check (auth.uid() = rider_id and status = 'cancelled');

drop policy if exists "Pickers can read open pickup requests" on public.pickup_requests;
create policy "Pickers can read open pickup requests"
  on public.pickup_requests for select
  using (
    status = 'open'
    and public.user_has_role('picker')
  );

drop policy if exists "Pickers can read their assigned pickup requests" on public.pickup_requests;
create policy "Pickers can read their assigned pickup requests"
  on public.pickup_requests for select
  using (auth.uid() = picker_id);

drop policy if exists "Pickers can accept an open pickup request" on public.pickup_requests;
create policy "Pickers can accept an open pickup request"
  on public.pickup_requests for update
  using (
    status = 'open'
    and public.user_has_role('picker')
  )
  with check (picker_id = auth.uid() and status = 'accepted');

drop policy if exists "Pickers can complete their assigned pickup request" on public.pickup_requests;
create policy "Pickers can complete their assigned pickup request"
  on public.pickup_requests for update
  using (auth.uid() = picker_id)
  with check (auth.uid() = picker_id);

drop policy if exists "Admins can read every pickup request" on public.pickup_requests;
create policy "Admins can read every pickup request"
  on public.pickup_requests for select
  using (public.user_has_role('admin'));

drop policy if exists "Admins can update every pickup request" on public.pickup_requests;
create policy "Admins can update every pickup request"
  on public.pickup_requests for update
  using (public.user_has_role('admin'));


-- ============================================================================
-- KOPI BOY 2.0 — Feature #005: Cart + Order Creation
-- Run this ONCE, after the Feature #002/#003 and picker-role scripts above,
-- in the same Supabase project's SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 12. ORDERS
-- One row per placed order. The app's checkout server action re-fetches real
-- menu_items prices and computes subtotal itself — never trust a
-- client-supplied total. No delivery_fee column yet — that's #007;
-- subtotal is the whole total until then.
--
-- order_status and payment_status are deliberately separate columns, per
-- the locked business rule that order/payment/preparation/delivery/incident
-- are separate status fields, not one combined enum (see docs/feature-001.md).
-- Feature #006 (cook accept/reject + PayNow) is what actually moves these:
-- a cook accepts/rejects (order_status), then separately marks payment_status
-- 'paid' once they've received the PayNow transfer off-platform — same
-- trust-based, no-in-app-gateway pattern already used for rider-pays-picker.
-- ----------------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  order_status text not null default 'placed' check (order_status in ('placed', 'accepted', 'rejected')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  subtotal numeric(7,2) not null check (subtotal > 0),
  decided_at timestamptz, -- set when order_status moves to accepted/rejected
  paid_at timestamptz, -- set when payment_status moves to paid
  created_at timestamptz not null default now()
);

alter table public.orders enable row level security;

-- select (customer own, cook own kitchen, admin), insert (customer own),
-- update (cook own kitchen, admin) — no delete policy (orders are never
-- deleted, only transitioned via order_status/payment_status).
grant select, insert, update on public.orders to authenticated;

drop policy if exists "Customers can create their own orders" on public.orders;
create policy "Customers can create their own orders"
  on public.orders for insert
  with check (auth.uid() = customer_id);

drop policy if exists "Customers can read their own orders" on public.orders;
create policy "Customers can read their own orders"
  on public.orders for select
  using (auth.uid() = customer_id);

drop policy if exists "Cooks can read orders placed at their kitchen" on public.orders;
create policy "Cooks can read orders placed at their kitchen"
  on public.orders for select
  using (auth.uid() = kitchen_id);

-- Transition rules (can't decide an already-decided order, can't mark paid
-- before accepted) are enforced by the app's update calls including the
-- expected current state in their WHERE clause, not by this policy — same
-- "first to accept wins" level of rigor already used for pickup_requests.
drop policy if exists "Cooks can update orders placed at their kitchen" on public.orders;
create policy "Cooks can update orders placed at their kitchen"
  on public.orders for update
  using (auth.uid() = kitchen_id)
  with check (auth.uid() = kitchen_id);

drop policy if exists "Admins can read every order" on public.orders;
create policy "Admins can read every order"
  on public.orders for select
  using (public.user_has_role('admin'));

-- ----------------------------------------------------------------------------
-- 13. ORDER ITEMS
-- One row per line item. name/price are snapshotted at order time (copied
-- from menu_items, not joined live) so a later menu edit or deletion never
-- rewrites what a customer actually ordered and was charged for. The Partner
-- app's KitchenSetupForm replaces a kitchen's menu_items wholesale on every
-- save, so menu_item_id is set null (not cascaded) if the original row is
-- gone — the snapshot is what matters for order history.
-- ----------------------------------------------------------------------------
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  name text not null,
  price numeric(6,2) not null check (price > 0),
  quantity int not null check (quantity > 0)
);

alter table public.order_items enable row level security;

-- select (customer own order, cook own kitchen's order, admin), insert
-- (customer own order) — no update or delete policy (line items are
-- immutable snapshots once an order is placed).
grant select, insert on public.order_items to authenticated;

drop policy if exists "Customers can create items on their own orders" on public.order_items;
create policy "Customers can create items on their own orders"
  on public.order_items for insert
  with check (
    exists (select 1 from public.orders o where o.id = order_items.order_id and o.customer_id = auth.uid())
  );

drop policy if exists "Customers can read items on their own orders" on public.order_items;
create policy "Customers can read items on their own orders"
  on public.order_items for select
  using (
    exists (select 1 from public.orders o where o.id = order_items.order_id and o.customer_id = auth.uid())
  );

drop policy if exists "Cooks can read items on orders placed at their kitchen" on public.order_items;
create policy "Cooks can read items on orders placed at their kitchen"
  on public.order_items for select
  using (
    exists (select 1 from public.orders o where o.id = order_items.order_id and o.kitchen_id = auth.uid())
  );

drop policy if exists "Admins can read every order item" on public.order_items;
create policy "Admins can read every order item"
  on public.order_items for select
  using (public.user_has_role('admin'));


-- ============================================================================
-- KOPI BOY 2.0 — Feature #006: Cook Accept/Reject + PayNow
-- Run this ONCE, after every script above, in the same Supabase project's
-- SQL Editor. (The order_status/payment_status split lives inside the #005
-- section above rather than as an ALTER here, since that migration hadn't
-- been run anywhere yet when #006 started.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 14. PAYNOW DETAILS ON KITCHENS
-- Previously only captured once on cook_applications (immutable after that
-- one-time form). Moved to kitchens — the live, cook-editable merchant
-- profile — so a customer has somewhere current to read it from once their
-- order is accepted, and a cook can update it later via the Partner app's
-- KitchenSetupForm. Backfilled below from each cook's most recently
-- approved application; the existing "Cooks can update their own kitchen" /
-- "Anyone can read live kitchens" policies already cover this column, no
-- new RLS needed.
-- ----------------------------------------------------------------------------
alter table public.kitchens add column if not exists paynow_uen text;

update public.kitchens k
set paynow_uen = (
  select ca.paynow_uen
  from public.cook_applications ca
  where ca.user_id = k.id and ca.status = 'approved'
  order by ca.reviewed_at desc nulls last
  limit 1
)
where k.paynow_uen is null;


-- ============================================================================
-- KOPI BOY 2.0 — Kitchen photo uploads (Supabase Storage)
-- Run this ONCE, after every script above, in the same Supabase project's
-- SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 15. KITCHEN-PHOTOS STORAGE BUCKET
-- Backs kitchens.hero_image and menu_items.photo_url: KitchenSetupForm
-- uploads the cook's chosen file here and stores the resulting public URL in
-- those columns, instead of asking cooks to host images themselves and paste
-- a URL. Public bucket — these photos are shown to customers in the
-- marketplace, same trust level as a live kitchen's name/menu. Objects are
-- stored under `<cook's auth uid>/...`, which is what the policies below
-- check via storage.foldername() to scope writes to the owning cook.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('kitchen-photos', 'kitchen-photos', true)
on conflict (id) do nothing;

drop policy if exists "Anyone can view kitchen photos" on storage.objects;
create policy "Anyone can view kitchen photos"
  on storage.objects for select
  using (bucket_id = 'kitchen-photos');

drop policy if exists "Cooks can upload their own kitchen photos" on storage.objects;
create policy "Cooks can upload their own kitchen photos"
  on storage.objects for insert
  with check (
    bucket_id = 'kitchen-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Cooks can update their own kitchen photos" on storage.objects;
create policy "Cooks can update their own kitchen photos"
  on storage.objects for update
  using (bucket_id = 'kitchen-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'kitchen-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Cooks can delete their own kitchen photos" on storage.objects;
create policy "Cooks can delete their own kitchen photos"
  on storage.objects for delete
  using (bucket_id = 'kitchen-photos' and (storage.foldername(name))[1] = auth.uid()::text);


-- ============================================================================
-- KOPI BOY 2.0 — Cook preparation status
-- Run this ONCE, after every script above, in the same Supabase project's
-- SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 16. PREPARATION STATUS ON ORDERS
-- Kitchen-side "is the food actually being made" tracking, separate from
-- order_status (accept/reject) and payment_status (PayNow received) per the
-- same locked business rule as those two (see docs/feature-001.md) —
-- order/payment/preparation/delivery/incident stay separate fields, never
-- one combined enum. A cook starts cooking only after accepting an order,
-- and marks it ready only after starting it — enforced the same
-- "app's update call includes the expected current state in its WHERE
-- clause" way as the order_status/payment_status transitions above, not by
-- a DB-level state machine. No rider-assignment logic yet — that's #008.
--
-- No new GRANT needed: the existing `grant select, insert, update on
-- public.orders to authenticated` above is table-level (no column list), so
-- it already covers this column, and the existing "Cooks can update orders
-- placed at their kitchen" policy (auth.uid() = kitchen_id, no column
-- restriction) already allows a cook to change it on their own kitchen's
-- orders.
-- ----------------------------------------------------------------------------
alter table public.orders
  add column if not exists preparation_status text not null default 'not_started'
  check (preparation_status in ('not_started', 'preparing', 'ready'));


-- ============================================================================
-- KOPI BOY 2.0 — PayNow method split on kitchens
-- Run this ONCE, after every script above, in the same Supabase project's
-- SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 17. PAYNOW TYPE + VALUE ON KITCHENS
-- Cooks pay into either a PayNow mobile number or a PayNow UEN, and a single
-- free-text `paynow_uen` column couldn't say which one a given value was.
-- Split into `paynow_type` (which kind) and `paynow_value` (the number/UEN
-- itself). Existing `paynow_uen` values are all UENs (that was the only kind
-- this column ever captured), so they're carried into `paynow_value` with
-- `paynow_type` set to 'uen'. No new GRANT/RLS needed — same as section 14,
-- the existing "Cooks can update their own kitchen" / "Anyone can read live
-- kitchens" policies already cover these columns.
-- ----------------------------------------------------------------------------
alter table public.kitchens add column if not exists paynow_type text check (paynow_type in ('mobile', 'uen'));
alter table public.kitchens add column if not exists paynow_value text;

update public.kitchens
set paynow_type = 'uen', paynow_value = paynow_uen
where paynow_uen is not null and paynow_value is null;

alter table public.kitchens drop column if exists paynow_uen;


-- ============================================================================
-- KOPI BOY 2.0 — Feature #008: Rider Delivery Requests
-- Run this ONCE, after every script above, in the same Supabase project's
-- SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 18. DELIVERY REQUESTS
-- The cook-initiated, rider-fulfilled handshake for the final leg: once a
-- cook marks an order preparation_status = 'ready', they request a rider ->
-- any approved rider can accept -> rider collects from the cook and marks
-- the delivery complete. Same "first to accept wins" pattern as
-- pickup_requests, with the cook/rider roles swapped for the picker/rider
-- roles there. Unlike pickup_requests, this table links to a real order
-- (order_id), so the fee is agreed directly between cook and rider
-- off-platform — no suggested_fee column here.
-- ----------------------------------------------------------------------------
create table if not exists public.delivery_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  rider_id uuid references public.profiles(id),
  status text not null default 'open' check (status in ('open', 'accepted', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz
);

alter table public.delivery_requests enable row level security;

-- select (cook own kitchen, rider open/assigned, admin), insert (cook own
-- kitchen), update (cook cancel, rider accept/complete, admin) — no delete
-- policy. Mirrors pickup_requests' grant exactly.
grant select, insert, update on public.delivery_requests to authenticated;

drop policy if exists "Cooks can create delivery requests for their own kitchen" on public.delivery_requests;
create policy "Cooks can create delivery requests for their own kitchen"
  on public.delivery_requests for insert
  with check (
    auth.uid() = kitchen_id
    and exists (select 1 from public.orders o where o.id = delivery_requests.order_id and o.kitchen_id = delivery_requests.kitchen_id)
  );

drop policy if exists "Cooks can read their own kitchen's delivery requests" on public.delivery_requests;
create policy "Cooks can read their own kitchen's delivery requests"
  on public.delivery_requests for select
  using (auth.uid() = kitchen_id);

drop policy if exists "Cooks can cancel their own open delivery requests" on public.delivery_requests;
create policy "Cooks can cancel their own open delivery requests"
  on public.delivery_requests for update
  using (auth.uid() = kitchen_id and status = 'open')
  with check (auth.uid() = kitchen_id and status = 'cancelled');

drop policy if exists "Riders can read open delivery requests" on public.delivery_requests;
create policy "Riders can read open delivery requests"
  on public.delivery_requests for select
  using (
    status = 'open'
    and public.user_has_role('rider')
  );

drop policy if exists "Riders can read their assigned delivery requests" on public.delivery_requests;
create policy "Riders can read their assigned delivery requests"
  on public.delivery_requests for select
  using (auth.uid() = rider_id);

drop policy if exists "Riders can accept an open delivery request" on public.delivery_requests;
create policy "Riders can accept an open delivery request"
  on public.delivery_requests for update
  using (
    status = 'open'
    and public.user_has_role('rider')
  )
  with check (rider_id = auth.uid() and status = 'accepted');

drop policy if exists "Riders can complete their assigned delivery request" on public.delivery_requests;
create policy "Riders can complete their assigned delivery request"
  on public.delivery_requests for update
  using (auth.uid() = rider_id)
  with check (auth.uid() = rider_id);

drop policy if exists "Admins can read every delivery request" on public.delivery_requests;
create policy "Admins can read every delivery request"
  on public.delivery_requests for select
  using (public.user_has_role('admin'));

drop policy if exists "Admins can update every delivery request" on public.delivery_requests;
create policy "Admins can update every delivery request"
  on public.delivery_requests for update
  using (public.user_has_role('admin'));


-- ============================================================================
-- KOPI BOY 2.0 — Kitchen geolocation
-- Run this ONCE, after every script above, in the same Supabase project's
-- SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 19. LATITUDE + LONGITUDE ON KITCHENS
-- Real coordinates alongside (not replacing) the free-text `neighbourhood`
-- field, captured via the browser's Geolocation API in KitchenSetupForm.
-- Both optional — a cook can decline the permission prompt or use a browser
-- without geolocation support and still go live with neighbourhood text
-- alone, same as hero_image being optional. No new GRANT/RLS needed — same
-- as sections 14/17, the existing `grant select, insert, update on
-- public.kitchens to authenticated` and "Cooks can update their own kitchen"
-- / "Anyone can read live kitchens" policies are table-level (no column
-- list) and already cover these columns.
-- ----------------------------------------------------------------------------
alter table public.kitchens add column if not exists latitude numeric(9,6);
alter table public.kitchens add column if not exists longitude numeric(9,6);


-- ============================================================================
-- KOPI BOY 2.0 — Order cancellation + delivery release
-- Run this ONCE, after every script above, in the same Supabase project's
-- SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 20. ORDER CANCELLATION (customer-facing, Customer app)
-- Widens order_status to allow a customer to cancel their own order while
-- it's still 'placed' — the Customer app's cancelOrder() action includes
-- `order_status = 'placed'` in its update's WHERE clause (same "current
-- state in the WHERE clause" pattern as accept/reject/preparation above),
-- with an RLS policy on the Customer app's own copy of this script as the
-- server-side backstop. ready_at is this repo's side of the same change:
-- set by markReady() below, alongside decided_at/paid_at, so the Customer
-- app's order-status timeline has a timestamp for the "ready" stage.
-- ----------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_order_status_check;
alter table public.orders add constraint orders_order_status_check
  check (order_status in ('placed', 'accepted', 'rejected', 'cancelled'));

alter table public.orders add column if not exists ready_at timestamptz; -- set when preparation_status moves to 'ready'

-- ----------------------------------------------------------------------------
-- 21. DELIVERY RELEASE
-- A rider who accepted a delivery can back out before completing it — the
-- request goes to 'release_requested' (not straight back to 'open') so the
-- cook is aware a rider dropped it before another rider can pick it up.
-- ----------------------------------------------------------------------------
alter table public.delivery_requests drop constraint if exists delivery_requests_status_check;
alter table public.delivery_requests add constraint delivery_requests_status_check
  check (status in ('open', 'accepted', 'completed', 'cancelled', 'release_requested'));


-- ============================================================================
-- KOPI BOY 2.0 — Rider photo + contact info
-- Run this ONCE, after every script above, in the same Supabase project's
-- SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 22. PHOTO COLUMNS ON RIDER_APPLICATIONS + PROFILES
-- `rider_applications.photo_url` is the one-time snapshot submitted with the
-- application (HQ reviews it; riders can't edit it afterwards — only admins
-- have an UPDATE policy on that table). `profiles.photo_url` is the rider's
-- live, self-editable photo, same idea as kitchens.hero_image being the live
-- copy of what a cook first entered on their application. ApplyForm writes the
-- photo to both, so it carries over on approval; the rider can then change
-- only the profiles copy from /account.
--
-- There is deliberately NO contact_number column: the contact number is
-- already captured on every application and stored as `profiles.phone` (see
-- ApplyForm), and that column is already the live, self-editable copy.
--
-- No new GRANT/RLS needed for these columns — same as sections 14/17/19, the
-- existing table-level `grant select, update on public.profiles` /
-- `grant select, insert, update on public.rider_applications` and the
-- "Users can update their own profile" / "Applicants can submit a rider
-- application" policies have no column list, so they already cover them, and
-- protect_profile_privileges (section 5) only reverts role/is_active.
-- ----------------------------------------------------------------------------
alter table public.rider_applications add column if not exists photo_url text;
alter table public.profiles add column if not exists photo_url text;

-- ----------------------------------------------------------------------------
-- 23. RIDER-PHOTOS STORAGE BUCKET
-- Same pattern as kitchen-photos (section 15): public read, and a user can only
-- write inside their own `<auth uid>/` folder. Not restricted to role = 'rider'
-- on purpose — an applicant uploads their photo *before* approval, while
-- profiles.role is still 'customer'. Unlike kitchen-photos this bucket also
-- caps size and mime type server-side, since it holds photos of people and the
-- client-side `accept` filter alone isn't a control. Re-running updates those
-- limits in place.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rider-photos', 'rider-photos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can view rider photos" on storage.objects;
create policy "Anyone can view rider photos"
  on storage.objects for select
  using (bucket_id = 'rider-photos');

drop policy if exists "Riders can upload their own rider photos" on storage.objects;
create policy "Riders can upload their own rider photos"
  on storage.objects for insert
  with check (
    bucket_id = 'rider-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Riders can update their own rider photos" on storage.objects;
create policy "Riders can update their own rider photos"
  on storage.objects for update
  using (bucket_id = 'rider-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'rider-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Riders can delete their own rider photos" on storage.objects;
create policy "Riders can delete their own rider photos"
  on storage.objects for delete
  using (bucket_id = 'rider-photos' and (storage.foldername(name))[1] = auth.uid()::text);


-- ============================================================================
-- KOPI BOY 2.0 — Customer-facing assigned-rider lookup
-- Run this ONCE, after every script above, in the same Supabase project's
-- SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 24. get_order_rider(): NAME + PHOTO OF THE RIDER ON MY ORDER
-- The Customer app shows the assigned rider's photo/name on the order page.
-- This is a function, not a `profiles` SELECT policy, on purpose: RLS decides
-- which ROWS a user can read, never which columns, and the table-level
-- `grant select on public.profiles` covers every column — so a policy letting
-- a customer read their rider's profile row would also hand over phone, role
-- and is_active. `profiles` keeps its own-row/admin-only read policies
-- unchanged; this SECURITY DEFINER function (runs as the table owner, so it can
-- read past them) is the only path, and it returns exactly two columns.
--
-- Returns a row only when ALL of these hold, otherwise it returns nothing:
--   * the order belongs to the caller (orders.customer_id = auth.uid()) —
--     so a customer can't look up someone else's order by id;
--   * the order has a delivery_request with status 'accepted' (a rider is on
--     the way) or 'completed' (delivered — the order page keeps showing who
--     brought it). If there are both, the completed one wins. Open (no rider
--     yet), cancelled and release_requested (rider backing out) return nothing.
--     This is the same rule as the Customer app's pickActiveDelivery().
-- This is the ONE definition of get_order_rider(): the Customer app's schema
-- deliberately does not define its own copy (two `create or replace`s of the
-- same signature would silently overwrite each other, whichever ran last).
-- Deliberately does not return rider_id (customers have no other way to read
-- delivery_requests, so it would be a new identifier for them to hold).
--
-- Execute is revoked from PUBLIC *and* anon/authenticated first because
-- Supabase's default privileges grant EXECUTE on new public functions to
-- anon/authenticated directly (revoking from PUBLIC alone doesn't undo that),
-- then granted back to authenticated only.
-- ----------------------------------------------------------------------------
create or replace function public.get_order_rider(p_order_id uuid)
returns table (full_name text, photo_url text)
language sql
stable
security definer
set search_path = public
as $$
  select p.full_name, p.photo_url
  from public.orders o
  join public.delivery_requests d on d.order_id = o.id and d.status in ('accepted', 'completed')
  join public.profiles p on p.id = d.rider_id
  where o.id = p_order_id
    and o.customer_id = auth.uid()
  order by (d.status = 'completed') desc, d.created_at desc
  limit 1;
$$;

revoke all on function public.get_order_rider(uuid) from public, anon, authenticated;
grant execute on function public.get_order_rider(uuid) to authenticated;


-- ============================================================================
-- KOPI BOY 2.0 — Picker photo
-- Run this ONCE, after every script above, in the same Supabase project's
-- SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 25. PHOTO COLUMN ON PICKER_APPLICATIONS
-- Same split as riders (section 22): `picker_applications.photo_url` is the
-- one-time snapshot HQ reviews (only admins can update that table), and
-- `profiles.photo_url` (already added in section 22) is the live copy the
-- picker edits from /account. ApplyForm writes both.
--
-- No new bucket: pickers upload to rider-photos (section 23). Its policies
-- were never rider-only (public read, write only inside your own `<uid>/`
-- folder, size/mime capped), so they already fit a picker exactly, and one
-- bucket keeps partner profile photos in one place. No new GRANT/RLS for the
-- column either, same reasoning as section 22.
-- ----------------------------------------------------------------------------
alter table public.picker_applications add column if not exists photo_url text;


-- ============================================================================
-- KOPI BOY 2.0 — Business registration number (UEN) for registered cooks
-- Run this ONCE, after every script above, in the same Supabase project's
-- SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 26. BUSINESS UEN ON COOK APPLICATIONS
-- Every business type except 'Home Cook' (Hawker, Bakery, Small Business)
-- must give its ACRA Business Registration Number; home cooks never carry
-- one. This is a NEW column, deliberately not a reuse of the old
-- `paynow_uen`: that one is payment details (and has lived on kitchens as
-- paynow_type/paynow_value since section 17), whereas a registration number
-- identifies the business itself. Many hawkers take PayNow on a mobile number
-- while still having a UEN, so the two can differ.
--
-- Enforced by a BEFORE INSERT trigger rather than a CHECK constraint: every
-- application already submitted has no business_uen, and a CHECK (even NOT
-- VALID) is re-evaluated on every UPDATE, so HQ approving one of those older
-- Hawker applications would start failing. Insert-only is exactly "new
-- applications must have it". Applicants have no UPDATE policy on this table,
-- so insert is the only way they write it. The trigger also normalises the
-- value (trimmed, upper-case) and checks it against the three ACRA formats:
--   * businesses        nnnnnnnnX    (8 digits + letter)
--   * local companies   yyyynnnnnX   (9 digits + letter)
--   * other entities    TyyPQnnnnX   (T/S/R, 2 digits, 2 letters, 4 digits, letter)
-- Same rule as src/lib/business-uen.ts, which gives the form its early error.
-- ----------------------------------------------------------------------------
alter table public.cook_applications add column if not exists business_uen text;

create or replace function public.check_cook_application_uen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.business_uen := nullif(upper(btrim(coalesce(new.business_uen, ''))), '');

  if new.business_type is not distinct from 'Home Cook' then
    new.business_uen := null;
  elsif new.business_uen is null then
    raise exception 'A Business Registration Number (UEN) is required for registered businesses.' using errcode = '23514';
  elsif new.business_uen !~ '^([0-9]{8}[A-Z]|[0-9]{9}[A-Z]|[TSR][0-9]{2}[A-Z]{2}[0-9]{4}[A-Z])$' then
    raise exception 'That doesn''t look like a valid UEN (e.g. 53123456X or 201912345K).' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists before_cook_application_insert on public.cook_applications;
create trigger before_cook_application_insert
  before insert on public.cook_applications
  for each row execute function public.check_cook_application_uen();

-- ----------------------------------------------------------------------------
-- 27. VERIFIED BUSINESS UEN ON KITCHENS (customer-facing trust signal)
-- kitchens.category is self-chosen by the cook in KitchenSetupForm, so it
-- can't back a "registered business" badge. kitchens.business_uen can: it is
-- never taken from the client. A BEFORE INSERT/UPDATE trigger always
-- overwrites it with the UEN on the cook's latest APPROVED application
-- (null if none), so whatever a cook sends for it is ignored, and approving
-- an application refreshes an existing kitchen. SECURITY DEFINER so the
-- approval path can update the cook's kitchen row (admins have no kitchens
-- UPDATE need otherwise) and so the lookup doesn't depend on who's writing.
-- The existing "Anyone can read live kitchens" policy has no column list, so
-- customers can read it with no new grant — UENs are public record (ACRA
-- BizFile), which is what makes showing it useful.
-- ----------------------------------------------------------------------------
alter table public.kitchens add column if not exists business_uen text;

create or replace function public.approved_business_uen(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select ca.business_uen
  from public.cook_applications ca
  where ca.user_id = p_user_id and ca.status = 'approved'
  order by ca.reviewed_at desc nulls last, ca.created_at desc
  limit 1;
$$;

revoke all on function public.approved_business_uen(uuid) from public, anon, authenticated;

create or replace function public.set_kitchen_business_uen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.business_uen := public.approved_business_uen(new.id);
  return new;
end;
$$;

drop trigger if exists before_kitchen_business_uen on public.kitchens;
create trigger before_kitchen_business_uen
  before insert or update on public.kitchens
  for each row execute function public.set_kitchen_business_uen();

create or replace function public.sync_kitchen_business_uen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The kitchens trigger above recomputes the value; this just makes it run.
  update public.kitchens set business_uen = null where id = new.user_id;
  return new;
end;
$$;

drop trigger if exists after_cook_application_review on public.cook_applications;
create trigger after_cook_application_review
  after update of status on public.cook_applications
  for each row
  when (old.status is distinct from new.status)
  execute function public.sync_kitchen_business_uen();

-- Backfill only kitchens whose owner has an approved UEN, so rows with
-- nothing to change keep their updated_at. (None yet on a fresh rollout:
-- existing applications predate the column.)
update public.kitchens k
set business_uen = null
where public.approved_business_uen(k.id) is distinct from k.business_uen;


-- ============================================================================
-- KOPI BOY 2.0 — Cook registration: private location, business types, halal,
-- terms
-- Run this ONCE, after every script above, in the same Supabase project's
-- SQL Editor. Safe to run on a database where an earlier draft of these
-- sections (a public kitchens.business_address / kitchens.postal_code) was
-- already run — section 28 migrates that data and removes those columns.
-- Section 34 (dropping kitchens.neighbourhood) is deliberately left commented
-- out — see its note before running it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 28. PRIVATE KITCHEN LOCATION (address, postal code, exact coordinates)
-- The free-text `neighbourhood` ("Toa Payoh") is replaced by a real street
-- address plus a 6-digit Singapore postal code, captured on cook_applications
-- at sign-up and seeded into the kitchen at setup.
--
-- Everything that pinpoints a home cook's home lives in kitchen_addresses,
-- which only the owning cook and admins can read:
--   * business_address — street address
--   * postal_code      — full 6-digit code (in Singapore one code = one
--                        building, so for a landed home it IS the house)
--   * latitude/longitude — the exact coordinates from KitchenSetupForm's
--                        "Use my current location"
-- The assigned rider/picker gets them only through section 30's functions.
-- The public kitchens row carries only coarse values derived from these by
-- section 29's triggers: postal_sector (first 2 digits) and
-- latitude/longitude rounded to 3 decimals (about 110 m).
--
-- Why a separate table rather than column-level grants on kitchens: RLS picks
-- rows, never columns, and kitchens is readable by anon/authenticated via
-- "Anyone can read live kitchens". Hiding columns there would need column
-- grants, which make every `select *` on kitchens (the Partner app's own
-- pages, and the Customer app) fail with "permission denied", and would also
-- hide the values from the cook who owns them, since grants are per role,
-- not per row. A separate table keeps `select *` working and lets RLS scope
-- the data to its owner.
--
-- cook_applications already has own-row/admin-only read policies, so its
-- business_address/postal_code columns are as private as the rest of the
-- application.
--
-- The postal_code CHECKs only validate the format when a value is present (a
-- NULL passes a CHECK), same rule as isValidPostalCode() in
-- src/lib/kitchen-profile.ts. Everything is nullable: kitchens that predate
-- this section have no address, and KitchenSetupForm requires address +
-- postal code on the cook's next save.
--
-- Migrating from earlier states, all guarded so re-running is a no-op:
--   * an earlier draft of this section put business_address and postal_code
--     directly on kitchens (publicly readable) — their values are copied into
--     kitchen_addresses and both columns are dropped;
--   * kitchens.latitude/longitude (section 19) held exact coordinates — they
--     are copied into kitchen_addresses before section 29 replaces the public
--     ones with rounded values. Only copied where kitchen_addresses has none
--     yet, so a re-run never overwrites exact values with rounded ones.
--
-- kitchens.neighbourhood was NOT NULL, and the Partner app no longer writes
-- it, so it's relaxed here or every new kitchen insert would fail until
-- section 34 drops it. cook_applications.neighbourhood was already nullable
-- and is kept as historical data (HQ review may show it).
-- ----------------------------------------------------------------------------
alter table public.cook_applications add column if not exists business_address text;
alter table public.cook_applications add column if not exists postal_code text;
alter table public.cook_applications drop constraint if exists cook_applications_postal_code_check;
alter table public.cook_applications add constraint cook_applications_postal_code_check
  check (postal_code ~ '^[0-9]{6}$');

create table if not exists public.kitchen_addresses (
  kitchen_id uuid primary key references public.kitchens(id) on delete cascade,
  business_address text,
  postal_code text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  updated_at timestamptz not null default now()
);

-- For a database where an earlier draft created this table with fewer
-- columns / a NOT NULL address.
alter table public.kitchen_addresses add column if not exists postal_code text;
alter table public.kitchen_addresses add column if not exists latitude numeric(9,6);
alter table public.kitchen_addresses add column if not exists longitude numeric(9,6);
alter table public.kitchen_addresses alter column business_address drop not null;
alter table public.kitchen_addresses drop constraint if exists kitchen_addresses_postal_code_check;
alter table public.kitchen_addresses add constraint kitchen_addresses_postal_code_check
  check (postal_code ~ '^[0-9]{6}$');

alter table public.kitchen_addresses enable row level security;

-- select/insert/update for the owning cook, select for admins — no delete
-- policy (rows only disappear via the kitchens-row cascade). anon gets
-- nothing: revoked explicitly because Supabase's default privileges grant
-- every new public table to anon.
revoke all on public.kitchen_addresses from anon;
grant select, insert, update on public.kitchen_addresses to authenticated;

drop policy if exists "Cooks can read their own kitchen address" on public.kitchen_addresses;
create policy "Cooks can read their own kitchen address"
  on public.kitchen_addresses for select
  using (auth.uid() = kitchen_id);

drop policy if exists "Cooks can insert their own kitchen address" on public.kitchen_addresses;
create policy "Cooks can insert their own kitchen address"
  on public.kitchen_addresses for insert
  with check (auth.uid() = kitchen_id);

drop policy if exists "Cooks can update their own kitchen address" on public.kitchen_addresses;
create policy "Cooks can update their own kitchen address"
  on public.kitchen_addresses for update
  using (auth.uid() = kitchen_id);

drop policy if exists "Admins can read every kitchen address" on public.kitchen_addresses;
create policy "Admins can read every kitchen address"
  on public.kitchen_addresses for select
  using (public.user_has_role('admin'));

-- Reuses section 8's function: its body only sets new.updated_at.
drop trigger if exists before_kitchen_address_update on public.kitchen_addresses;
create trigger before_kitchen_address_update
  before update on public.kitchen_addresses
  for each row execute function public.touch_kitchen_updated_at();

do $$
begin
  -- Earlier draft: public kitchens.business_address.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'kitchens' and column_name = 'business_address'
  ) then
    execute $sql$
      insert into public.kitchen_addresses as ka (kitchen_id, business_address)
      select id, nullif(btrim(business_address), '') from public.kitchens
      where nullif(btrim(business_address), '') is not null
      on conflict (kitchen_id) do update
        set business_address = coalesce(ka.business_address, excluded.business_address)
    $sql$;
    alter table public.kitchens drop column business_address;
  end if;

  -- Earlier draft: public kitchens.postal_code (its CHECK goes with it).
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'kitchens' and column_name = 'postal_code'
  ) then
    execute $sql$
      insert into public.kitchen_addresses as ka (kitchen_id, postal_code)
      select id, postal_code from public.kitchens
      where postal_code is not null
      on conflict (kitchen_id) do update
        set postal_code = coalesce(ka.postal_code, excluded.postal_code)
    $sql$;
    alter table public.kitchens drop column postal_code;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'kitchens' and column_name = 'neighbourhood'
  ) then
    alter table public.kitchens alter column neighbourhood drop not null;
  end if;
end;
$$;

-- Section 19's exact coordinates, before section 29 rounds the public copy.
insert into public.kitchen_addresses as ka (kitchen_id, latitude, longitude)
select id, latitude, longitude from public.kitchens
where latitude is not null and longitude is not null
on conflict (kitchen_id) do update
  set latitude = excluded.latitude, longitude = excluded.longitude
  where ka.latitude is null or ka.longitude is null;

-- ----------------------------------------------------------------------------
-- 29. PUBLIC, COARSE LOCATION ON KITCHENS (derived, never client-written)
-- What anyone browsing sees:
--   * kitchens.postal_sector — the first 2 digits of the postal code (the
--     Customer app shows "Postal sector 31")
--   * kitchens.latitude/longitude — rounded to 3 decimal places. At
--     Singapore's latitude that's a ~110 m grid, i.e. the true spot is within
--     ~55 m (lat) / ~55 m (long) of the published point — fine for distance
--     sorting, useless for finding a front door.
-- Same approach as section 27's business_uen: a BEFORE INSERT/UPDATE trigger
-- on kitchens always overwrites these three from kitchen_addresses, so
-- whatever a client sends for them is ignored (a cook can't publish exact
-- coordinates even by accident, and an old app build that still writes
-- kitchens.latitude gets rounded). An AFTER trigger on kitchen_addresses
-- makes the kitchens row recompute whenever the private values change.
-- Both SECURITY DEFINER so they work regardless of who is writing (the
-- recompute updates the kitchens row the cook's address belongs to).
-- No new GRANT/RLS: postal_sector is covered by the table-level kitchens
-- grants and "Anyone can read live kitchens", same as section 19.
-- ----------------------------------------------------------------------------
alter table public.kitchens add column if not exists postal_sector text;
alter table public.kitchens drop constraint if exists kitchens_postal_sector_check;
alter table public.kitchens add constraint kitchens_postal_sector_check
  check (postal_sector ~ '^[0-9]{2}$');

create or replace function public.set_kitchen_public_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  loc record;
begin
  -- No kitchen_addresses row yet -> every field of loc is NULL.
  select latitude, longitude, postal_code into loc
  from public.kitchen_addresses
  where kitchen_id = new.id;

  new.latitude := round(loc.latitude, 3);
  new.longitude := round(loc.longitude, 3);
  new.postal_sector := left(loc.postal_code, 2);
  return new;
end;
$$;

drop trigger if exists before_kitchen_public_location on public.kitchens;
create trigger before_kitchen_public_location
  before insert or update on public.kitchens
  for each row execute function public.set_kitchen_public_location();

create or replace function public.sync_kitchen_public_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The kitchens trigger above recomputes the values; this just makes it run.
  update public.kitchens set postal_sector = null where id = new.kitchen_id;
  return new;
end;
$$;

drop trigger if exists after_kitchen_address_change on public.kitchen_addresses;
create trigger after_kitchen_address_change
  after insert or update of postal_code, latitude, longitude on public.kitchen_addresses
  for each row execute function public.sync_kitchen_public_location();

-- Recompute every kitchen once, replacing section 19's exact coordinates with
-- rounded ones. Only rows whose public values would change, so the rest keep
-- their updated_at.
update public.kitchens k
set postal_sector = null
from (
  select k2.id,
         round(ka.latitude, 3) as lat,
         round(ka.longitude, 3) as lng,
         left(ka.postal_code, 2) as sector
  from public.kitchens k2
  left join public.kitchen_addresses ka on ka.kitchen_id = k2.id
) d
where d.id = k.id
  and (d.lat is distinct from k.latitude
       or d.lng is distinct from k.longitude
       or d.sector is distinct from k.postal_sector);

-- ----------------------------------------------------------------------------
-- 30. REVEALING THE EXACT LOCATION TO THE ASSIGNED RIDER / PICKER
-- Two SECURITY DEFINER functions, the only way anyone other than the cook or
-- an admin can read a kitchen_addresses row. Same pattern as section 24's
-- get_order_rider(): each takes one request id, checks the caller is the
-- person assigned to it right now, and returns one row of
-- (business_address, postal_code, latitude, longitude) — or no row at all,
-- so a caller can't tell "not yours" from "nothing saved".
--
-- get_delivery_kitchen_location(delivery_request_id): the caller is that
-- delivery's rider AND it's 'accepted'. Open (nobody assigned yet),
-- release_requested (the rider is backing out), completed and cancelled all
-- return nothing, so access ends when the job does.
--
-- get_pickup_kitchen_location(pickup_request_id): the caller is that
-- pickup's picker AND it's 'accepted' AND the rider who requested the pickup
-- currently holds an accepted delivery at the same kitchen. pickup_requests
-- aren't linked to a delivery (see section 11), so without that last check a
-- rider could open a pickup request at any live kitchen and have a picker
-- friend accept it just to read the location. The requesting rider doesn't
-- need a pickup path of their own: they read it through their delivery.
--
-- Deliberately NOT copied into notifications/push payloads: those rows
-- persist after the job ends (and push text can sit on a lock screen),
-- whereas these functions stop answering the moment the request moves on.
--
-- An earlier draft had address-only versions under other names
-- (get_*_kitchen_address); they're dropped so nothing keeps a second path.
-- Execute is revoked from PUBLIC *and* anon/authenticated first (Supabase
-- grants those directly on new functions — same note as get_order_rider),
-- then granted back to authenticated only.
-- ----------------------------------------------------------------------------
drop function if exists public.get_delivery_kitchen_address(uuid);
drop function if exists public.get_pickup_kitchen_address(uuid);

create or replace function public.get_delivery_kitchen_location(p_delivery_request_id uuid)
returns table (business_address text, postal_code text, latitude numeric, longitude numeric)
language sql
stable
security definer
set search_path = public
as $$
  select ka.business_address, ka.postal_code, ka.latitude, ka.longitude
  from public.delivery_requests d
  join public.kitchen_addresses ka on ka.kitchen_id = d.kitchen_id
  where d.id = p_delivery_request_id
    and d.rider_id = auth.uid()
    and d.status = 'accepted';
$$;

revoke all on function public.get_delivery_kitchen_location(uuid) from public, anon, authenticated;
grant execute on function public.get_delivery_kitchen_location(uuid) to authenticated;

create or replace function public.get_pickup_kitchen_location(p_pickup_request_id uuid)
returns table (business_address text, postal_code text, latitude numeric, longitude numeric)
language sql
stable
security definer
set search_path = public
as $$
  select ka.business_address, ka.postal_code, ka.latitude, ka.longitude
  from public.pickup_requests pr
  join public.kitchen_addresses ka on ka.kitchen_id = pr.kitchen_id
  where pr.id = p_pickup_request_id
    and pr.picker_id = auth.uid()
    and pr.status = 'accepted'
    and exists (
      select 1 from public.delivery_requests d
      where d.kitchen_id = pr.kitchen_id
        and d.rider_id = pr.rider_id
        and d.status = 'accepted'
    );
$$;

revoke all on function public.get_pickup_kitchen_location(uuid) from public, anon, authenticated;
grant execute on function public.get_pickup_kitchen_location(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 31. NEW KITCHEN CATEGORIES
-- The business type list is now exactly: Home Cook, Hawker, Bakery,
-- Vegetarian, Drinks & Desserts. Same drop-and-recreate as section 9 (a check
-- constraint can't be edited in place; `kitchens_category_check` is the name
-- Postgres auto-generated for section 6's inline check). Existing rows are
-- remapped BETWEEN the drop and the re-add so the new constraint can't fail:
--   * 'drinks'      -> 'drinks-desserts' (same category; its label was
--                      already "Desserts & Drinks")
--   * 'bulk-orders' -> 'home-cook' (no direct equivalent; bulk/catering
--                      orders come overwhelmingly from home cooks, and the
--                      cook can re-pick in KitchenSetupForm)
--   * anything else outside the new list also -> 'home-cook', as a safety net.
-- cook_applications.business_type is free text holding the display LABEL
-- (check_cook_application_uen() in section 26 compares it to 'Home Cook'), so
-- it has no constraint to change; older applications keep their old label.
-- ----------------------------------------------------------------------------
alter table public.kitchens drop constraint if exists kitchens_category_check;

update public.kitchens set category = 'drinks-desserts' where category = 'drinks';
update public.kitchens set category = 'home-cook'
where category not in ('home-cook', 'hawker', 'bakery', 'vegetarian', 'drinks-desserts');

alter table public.kitchens add constraint kitchens_category_check
  check (category in ('home-cook', 'hawker', 'bakery', 'vegetarian', 'drinks-desserts'));

-- ----------------------------------------------------------------------------
-- 32. HALAL FLAG ON KITCHENS (customer-facing)
-- A plain yes/no the cook ticks in KitchenSetupForm, independent of
-- cuisine_type (a Western or Indian kitchen can be halal too). Backfilled to
-- true for kitchens whose cuisine_type is already 'halal'.
--
-- Readable by the Customer app with no column-level grant, same as every
-- other public kitchen field: the "Anyone can read live kitchens" policy has
-- no column list. That policy has always been meant for signed-out customers
-- too, but this file only ever granted kitchens to `authenticated` — anon
-- reads have been relying on Supabase's implicit default privileges (see the
-- note at the top of this file). The explicit `grant select ... to anon`
-- below makes that dependency real rather than implicit; it's a no-op on a
-- project where anon already has it. RLS still limits anon to live kitchens,
-- and nothing precise is on kitchens any more (sections 28–29).
-- ----------------------------------------------------------------------------
alter table public.kitchens add column if not exists is_halal boolean not null default false;

update public.kitchens set is_halal = true where cuisine_type = 'halal' and not is_halal;

grant select on public.kitchens to anon;

-- ----------------------------------------------------------------------------
-- 33. PARTNER TERMS ACKNOWLEDGEMENT ON KITCHENS
-- Before a kitchen can go live the cook must tick: "I acknowledge that Kopi
-- Boy only connects customers with cooks. I am responsible for food safety,
-- hygiene, pricing, and fulfilling orders I accept. Kopi Boy does not process
-- payments or guarantee income." Stored on kitchens rather than
-- cook_applications because KitchenSetupForm is the step that actually puts a
-- cook in front of customers, and because cooks already approved (who will
-- never fill in an application again) can be asked for it on their next save.
--
-- The client only signals "ticked" by sending any non-null value; this
-- BEFORE INSERT/UPDATE trigger decides the stored timestamp:
--   * already acknowledged -> the original timestamp is kept, always (a cook
--     can neither clear it nor move it)
--   * first acknowledgement -> stamped with the server's now(), never the
--     client's clock
--   * INSERT without it -> rejected (a new kitchen can't exist unacknowledged)
-- UPDATEs of older, unacknowledged kitchens without it are allowed, so
-- server-side paths like section 27's business_uen sync and section 29's
-- location sync keep working; KitchenSetupForm won't save such a kitchen
-- until the box is ticked. Supabase's upsert (INSERT ... ON CONFLICT DO
-- UPDATE) fires the INSERT trigger first and then the UPDATE one, which
-- restores the original.
-- ----------------------------------------------------------------------------
alter table public.kitchens add column if not exists acknowledged_terms_at timestamptz;

create or replace function public.stamp_kitchen_terms_acknowledgement()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.acknowledged_terms_at is not null then
    new.acknowledged_terms_at := old.acknowledged_terms_at;
  elsif new.acknowledged_terms_at is not null then
    new.acknowledged_terms_at := now();
  elsif tg_op = 'INSERT' then
    raise exception 'Please acknowledge the Kopi Boy partner terms before setting up your kitchen.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists before_kitchen_terms_acknowledgement on public.kitchens;
create trigger before_kitchen_terms_acknowledgement
  before insert or update on public.kitchens
  for each row execute function public.stamp_kitchen_terms_acknowledgement();

-- ----------------------------------------------------------------------------
-- 34. DROP kitchens.neighbourhood — ON HOLD, DO NOT UNCOMMENT YET
-- Uncomment and run only once BOTH are true:
--   1. The Customer app (and Boss app, if it reads kitchens) no longer
--      selects kitchens.neighbourhood — a select naming a missing column
--      fails the whole query, not just that field.
--   2. docs/supabase-notifications.sql has been re-run, so
--      notify_on_delivery_change() / notify_on_pickup_change() read
--      postal_sector instead. Their old versions select neighbourhood inside
--      an exception handler, so they wouldn't break orders — they'd silently
--      stop sending delivery/pickup notifications.
-- ----------------------------------------------------------------------------
-- alter table public.kitchens drop column if exists neighbourhood;

-- ----------------------------------------------------------------------------
-- 35. PROMOTE profiles.role WHEN AN APPLICATION IS APPROVED
-- Section 4 says cooks/riders/pickers get their role "via an approved
-- application", but nothing did it: approving only flipped the application's
-- status. resolvePartnerScreen (src/lib/partner-routing.ts) already routes an
-- approved-but-unpromoted cook into Kitchen Setup, where the kitchens upsert
-- then failed "Cooks can insert their own kitchen" (it requires
-- user_has_role('cook')) with "new row violates row-level security policy
-- for table kitchens". Riders/pickers hit the same wall on their own
-- role-gated policies.
--
-- An AFTER INSERT/UPDATE trigger on each application table sets the role
-- when the row becomes 'approved'. Only a 'customer' is promoted: an admin
-- is never demoted, and an existing partner of another kind keeps their
-- current role (one role per profile; HQ changes it by hand if needed).
-- SECURITY DEFINER so it works whoever approves.
--
-- protect_profile_privileges (section 5) reverted role changes unless the
-- caller is an admin — including when there is no caller at all (SQL editor,
-- service role), where auth.uid() is null, so an approval from those paths
-- could never promote anyone. It now also lets those through: every
-- signed-in or anon request carries a JWT, and anon has no UPDATE grant on
-- profiles, so a null auth.uid() only ever means a trusted server context.
-- ----------------------------------------------------------------------------
create or replace function public.protect_profile_privileges()
returns trigger as $$
begin
  if auth.uid() is not null and not public.user_has_role('admin') then
    new.role := old.role;
    new.is_active := old.is_active;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.promote_approved_applicant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- tg_argv[0] is the role this application grants: 'cook', 'rider' or 'picker'.
  update public.profiles
  set role = tg_argv[0]
  where id = new.user_id and role = 'customer';
  return new;
end;
$$;

revoke all on function public.promote_approved_applicant() from public, anon, authenticated;

drop trigger if exists after_cook_application_approved on public.cook_applications;
create trigger after_cook_application_approved
  after insert or update of status on public.cook_applications
  for each row
  when (new.status = 'approved')
  execute function public.promote_approved_applicant('cook');

drop trigger if exists after_rider_application_approved on public.rider_applications;
create trigger after_rider_application_approved
  after insert or update of status on public.rider_applications
  for each row
  when (new.status = 'approved')
  execute function public.promote_approved_applicant('rider');

drop trigger if exists after_picker_application_approved on public.picker_applications;
create trigger after_picker_application_approved
  after insert or update of status on public.picker_applications
  for each row
  when (new.status = 'approved')
  execute function public.promote_approved_applicant('picker');

-- Backfill: everyone already approved but still a customer. Cook first, then
-- rider, then picker — the `role = 'customer'` guard means whichever matches
-- first wins for someone approved as more than one kind.
update public.profiles p set role = 'cook'
where p.role = 'customer'
  and exists (select 1 from public.cook_applications a where a.user_id = p.id and a.status = 'approved');
update public.profiles p set role = 'rider'
where p.role = 'customer'
  and exists (select 1 from public.rider_applications a where a.user_id = p.id and a.status = 'approved');
update public.profiles p set role = 'picker'
where p.role = 'customer'
  and exists (select 1 from public.picker_applications a where a.user_id = p.id and a.status = 'approved');

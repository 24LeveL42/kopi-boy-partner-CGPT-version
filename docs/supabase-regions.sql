-- ============================================================================
-- KOPI BOY — Regions (North / South / East / West)
--
-- Two parts, each ONE transaction, each safe to re-run, run separately and in
-- this order:
--   Part A: the regions, the postal sector -> region map, kitchens.region
--           (derived by its own trigger, never typed), the resync when the
--           map changes, the backfill, and the public grant of region
--           (15 public kitchens columns become 16).
--   Part B: riders' regions. Riders pick their own (set_my_ride_regions), HQ
--           can change them in Boss (admin_set_rider_regions). No home
--           address or postal code is ever stored for a rider.
-- Read-only checks and the UNDO are at the end of the file.
--
-- RUN ORDER: after docs/supabase-schema.sql sections 28 and 29 (kitchen
-- location) and both kitchen privacy files (Customer Phase 1, Partner
-- docs/supabase-kitchen-privacy-phase2.sql). Both privacy files grant region
-- back by themselves when the column exists, so re-running either one later
-- keeps region readable.
--
-- kitchens.region has its OWN trigger (before_kitchen_region). Section 29's
-- set_kitchen_public_location() is not edited, so re-running section 29 can't
-- stop region updates. Section 29's AFTER trigger on kitchen_addresses
-- updates the kitchens row, which fires before_kitchen_region too, so a cook
-- changing their postal code moves their region with no change to section 29.
--
-- Nothing here changes RLS on kitchens, the INSERT/UPDATE grants on kitchens,
-- the 5 private kitchens columns, get_order_paynow, get_my_kitchen_private,
-- admin_get_kitchen_private, kitchen_public_locations, hero_candidates,
-- quote_delivery, place_order or the approval triggers.
-- ============================================================================

-- CHECK 0 (read only, before Part A).
-- a) Today's grants (expect anon 15, authenticated 15):
-- select grantee, count(*) from information_schema.column_privileges where table_schema = 'public' and table_name = 'kitchens' and privilege_type = 'SELECT' and grantee in ('anon', 'authenticated') group by grantee order by grantee;
-- b) Every trigger on kitchens; the Part A backfill UPDATE fires them all for the rows it changes:
-- select tgname from pg_trigger where tgrelid = 'public.kitchens'::regclass and not tgisinternal order by tgname;


-- ============================================================================
-- PART A — REGIONS, SECTOR MAP, kitchens.region
-- ============================================================================
begin;

-- A0. Stop if what this relies on is missing (nothing has changed yet).
do $$
declare
  v_missing text;
begin
  select string_agg(item, ', ' order by item) into v_missing
  from (
    select 'kitchens.postal_sector' as item
    where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'kitchens' and column_name = 'postal_sector')
    union all
    select 'kitchen_addresses.postal_code'
    where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'kitchen_addresses' and column_name = 'postal_code')
    union all
    select 'user_has_role()'
    where not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname = 'user_has_role')
    union all
    select 'touch_kitchen_updated_at()'
    where not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname = 'touch_kitchen_updated_at')
  ) m;
  if v_missing is not null then
    raise exception 'regions Part A: missing %. Nothing was changed.', v_missing;
  end if;
end;
$$;

-- A1. The four regions. Changing the set is a code change (chips, labels).
create table if not exists public.regions (
  code text primary key check (code in ('north', 'south', 'east', 'west')),
  label text not null,
  sort_order int not null
);
insert into public.regions (code, label, sort_order) values
  ('north', 'North', 1), ('south', 'South', 2), ('east', 'East', 3), ('west', 'West', 4)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

alter table public.regions enable row level security;
revoke all on public.regions from anon, authenticated;
grant select on public.regions to anon, authenticated;
drop policy if exists "Anyone can read regions" on public.regions;
create policy "Anyone can read regions" on public.regions for select using (true);

-- A2. Postal sector -> region. Editable by admins. Public knowledge with no
-- personal data, so anyone may read it (the Customer server uses it to find
-- the customer's own region).
create table if not exists public.postal_sector_regions (
  sector text primary key check (sector ~ '^[0-9]{2}$'),
  region text not null references public.regions(code),
  area text not null,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.postal_sector_regions enable row level security;
revoke all on public.postal_sector_regions from anon, authenticated;
grant select on public.postal_sector_regions to anon, authenticated;
grant insert, update, delete on public.postal_sector_regions to authenticated;

drop policy if exists "Anyone can read the sector map" on public.postal_sector_regions;
create policy "Anyone can read the sector map"
  on public.postal_sector_regions for select using (true);
drop policy if exists "Admins can change the sector map" on public.postal_sector_regions;
create policy "Admins can change the sector map"
  on public.postal_sector_regions for all to authenticated
  using (public.user_has_role('admin'))
  with check (public.user_has_role('admin'));

-- Reuses schema section 8's function: its body only sets new.updated_at.
drop trigger if exists before_postal_sector_regions_update on public.postal_sector_regions;
create trigger before_postal_sector_regions_update
  before update on public.postal_sector_regions
  for each row execute function public.touch_kitchen_updated_at();

-- Seed: the accepted mapping, 81 sectors (01-82, 74 is not in use). There is
-- no Central region: central sectors go to South unless clearly nearer
-- another region. ON CONFLICT DO NOTHING: a re-run never undoes an edit HQ
-- made. Sectors 00, 74 and 83-99 have no row, so they give region NULL.
insert into public.postal_sector_regions (sector, region, area, note)
select pg_catalog.lpad(s::text, 2, '0'), m.region, m.area, m.note
from (values
  ( 1,  6, 'south', 'Raffles Place, Cecil, Marina, People''s Park', 'central rule'),
  ( 7,  8, 'south', 'Anson, Tanjong Pagar', 'central rule'),
  ( 9, 10, 'south', 'Telok Blangah, HarbourFront, Sentosa', null),
  (11, 13, 'west',  'Pasir Panjang, Clementi New Town, West Coast', 'ambiguous: Pasir Panjang is south-west'),
  (14, 16, 'south', 'Queenstown, Tiong Bahru, Alexandra', 'ambiguous: Queenstown could be West'),
  (17, 23, 'south', 'Beach Road, Middle Road, Little India, Orchard, River Valley', 'central rule'),
  (24, 27, 'south', 'Ardmore, Bukit Timah, Holland Road, Tanglin', 'ambiguous: Bukit Timah/Holland could be West'),
  (28, 30, 'south', 'Watten Estate, Novena, Thomson', 'ambiguous: Novena/Thomson could be North'),
  (31, 33, 'south', 'Balestier, Toa Payoh, Serangoon', 'ambiguous: Toa Payoh could be North'),
  (34, 37, 'east',  'Macpherson, Braddell', 'ambiguous: Braddell could be South'),
  (38, 41, 'east',  'Geylang, Eunos, Aljunied', 'ambiguous: Geylang is officially Central'),
  (42, 45, 'east',  'Katong, Joo Chiat, Amber Road, Marine Parade', 'ambiguous (mild): Marine Parade is officially Central'),
  (46, 52, 'east',  'Bedok, Upper East Coast, Loyang, Changi, Tampines, Pasir Ris', null),
  (53, 55, 'east',  'Serangoon Garden, Hougang, Sengkang', 'ambiguous: north-east'),
  (56, 57, 'north', 'Bishan, Ang Mo Kio', 'ambiguous: Bishan central, Ang Mo Kio north-east'),
  (58, 59, 'west',  'Upper Bukit Timah, Clementi Park, Hume Avenue', 'ambiguous: Upper Bukit Timah'),
  (60, 68, 'west',  'Jurong, Boon Lay, Tuas, Hillview, Bukit Panjang, Choa Chu Kang', null),
  (69, 71, 'west',  'Lim Chu Kang, Tengah', 'ambiguous (mild): Lim Chu Kang is north-west'),
  (72, 73, 'north', 'Kranji, Woodgrove, Woodlands', null),
  (75, 76, 'north', 'Yishun, Sembawang', null),
  (77, 78, 'north', 'Upper Thomson, Springleaf', 'ambiguous (mild): Upper Thomson'),
  (79, 80, 'north', 'Seletar', 'ambiguous: Seletar is north-east'),
  (81, 81, 'east',  'Loyang, Changi', null),
  (82, 82, 'east',  'Punggol', 'ambiguous: Punggol, north-east')
) as m(first_sector, last_sector, region, area, note)
cross join lateral pg_catalog.generate_series(m.first_sector, m.last_sector) as s
on conflict (sector) do nothing;

-- A3. The public, derived column. The FK means it can only hold a real region.
alter table public.kitchens add column if not exists region text references public.regions(code);
create index if not exists kitchens_region_idx on public.kitchens (region);

-- A4. Its own BEFORE trigger. It reads the private postal code directly, so
-- it doesn't depend on trigger order or on section 29's function body. No
-- address, no postal code, or an unmapped sector: no row, so NULL. Whatever a
-- client sends for region is always overwritten.
create or replace function public.set_kitchen_region()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select r.region into new.region
  from public.kitchen_addresses ka
  join public.postal_sector_regions r on r.sector = pg_catalog.left(ka.postal_code, 2)
  where ka.kitchen_id = new.id;
  return new;
end;
$$;
revoke all on function public.set_kitchen_region() from public, anon, authenticated;

drop trigger if exists before_kitchen_region on public.kitchens;
create trigger before_kitchen_region
  before insert or update on public.kitchens
  for each row execute function public.set_kitchen_region();

-- A5. When the sector map changes, re-derive only the kitchens whose region
-- changes. Setting region = null makes A4 recompute it; the other kitchens
-- keep their updated_at.
create or replace function public.resync_kitchen_regions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.kitchens k
  set region = null
  where k.region is distinct from (
    select r.region
    from public.kitchen_addresses ka
    join public.postal_sector_regions r on r.sector = pg_catalog.left(ka.postal_code, 2)
    where ka.kitchen_id = k.id);
  return null;
end;
$$;
revoke all on function public.resync_kitchen_regions() from public, anon, authenticated;

drop trigger if exists after_postal_sector_regions_change on public.postal_sector_regions;
create trigger after_postal_sector_regions_change
  after insert or update or delete on public.postal_sector_regions
  for each statement execute function public.resync_kitchen_regions();

-- A6. Backfill existing kitchens, touching only rows whose region changes.
-- On a first run this is what fills region in (the column and the A5
-- trigger didn't exist yet when A2 seeded). On a re-run it finds nothing.
update public.kitchens k
set region = null
where k.region is distinct from (
  select r.region
  from public.kitchen_addresses ka
  join public.postal_sector_regions r on r.sector = pg_catalog.left(ka.postal_code, 2)
  where ka.kitchen_id = k.id);

-- A7. THE PUBLIC GRANT: 15 public columns become 16, for both roles. This is
-- additive and touches no other grant. The 5 private columns (paynow_type,
-- paynow_value, latitude, longitude, acknowledged_terms_at) stay ungranted,
-- there is still no table-wide SELECT, and select * on kitchens still fails.
grant select (region) on public.kitchens to anon, authenticated;

notify pgrst, 'reload schema';

commit;


-- ============================================================================
-- PART B — RIDERS' REGIONS (no address, no postal code: just the regions)
-- ============================================================================
begin;

-- B0. Stop if what this relies on is missing (nothing has changed yet).
do $$
declare
  v_missing text;
begin
  select string_agg(item, ', ' order by item) into v_missing
  from (
    select 'regions (run Part A first)' as item
    where not exists (select 1 from information_schema.tables
                      where table_schema = 'public' and table_name = 'regions')
    union all
    select 'rider_applications'
    where not exists (select 1 from information_schema.tables
                      where table_schema = 'public' and table_name = 'rider_applications')
    union all
    select 'profiles'
    where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'profiles' and column_name = 'role')
    union all
    select 'auth.users'
    where not exists (select 1 from information_schema.tables
                      where table_schema = 'auth' and table_name = 'users')
    union all
    select 'user_has_role()'
    where not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname = 'user_has_role')
  ) m;
  if v_missing is not null then
    raise exception 'regions Part B: missing %. Nothing was changed.', v_missing;
  end if;
end;
$$;

-- B1. One row per rider and region. Rows go with the user (ON DELETE CASCADE).
create table if not exists public.rider_regions (
  user_id uuid not null references auth.users(id) on delete cascade,
  region text not null references public.regions(code),
  created_at timestamptz not null default now(),
  primary key (user_id, region)
);
alter table public.rider_regions enable row level security;

-- Read only for signed-in users; every write goes through B3 or B4. anon gets
-- nothing (revoked explicitly: Supabase grants every new public table to it).
revoke all on public.rider_regions from anon, authenticated;
grant select on public.rider_regions to authenticated;
drop policy if exists "Riders can read their own regions" on public.rider_regions;
create policy "Riders can read their own regions"
  on public.rider_regions for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "Admins can read every rider's regions" on public.rider_regions;
create policy "Admins can read every rider's regions"
  on public.rider_regions for select to authenticated
  using (public.user_has_role('admin'));

-- B2. Shared by B3 and B4, callable by neither anon nor authenticated
-- directly. Replaces p_user's regions with exactly p_regions, in one step:
-- the user must be a rider or have a rider application (any status), and the
-- list must name at least one real region. Codes are trimmed and lowercased;
-- duplicates and blanks are ignored.
create or replace function public.replace_rider_regions(p_user uuid, p_regions text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean text[];
begin
  if p_user is null then
    raise exception 'Choose a rider.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user and p.role = 'rider')
     and not exists (select 1 from public.rider_applications a where a.user_id = p_user) then
    raise exception 'Only riders and rider applicants have ride regions.' using errcode = '42501';
  end if;

  select pg_catalog.array_agg(distinct pg_catalog.lower(pg_catalog.btrim(x))) into v_clean
  from pg_catalog.unnest(coalesce(p_regions, '{}'::text[])) as x
  where pg_catalog.btrim(x) <> '';
  if v_clean is null then
    raise exception 'Pick at least one region.' using errcode = '22023';
  end if;
  if exists (select 1 from pg_catalog.unnest(v_clean) as x
             where not exists (select 1 from public.regions r where r.code = x)) then
    raise exception 'Unknown region. Use north, south, east or west.' using errcode = '22023';
  end if;

  delete from public.rider_regions rr where rr.user_id = p_user and rr.region <> all (v_clean);
  insert into public.rider_regions (user_id, region)
  select p_user, x from pg_catalog.unnest(v_clean) as x
  on conflict (user_id, region) do nothing;
end;
$$;
revoke all on function public.replace_rider_regions(uuid, text[]) from public, anon, authenticated;

-- B3. The signed-in rider (or rider applicant) sets their own regions.
create or replace function public.set_my_ride_regions(p_regions text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  perform public.replace_rider_regions(v_uid, p_regions);
end;
$$;
revoke all on function public.set_my_ride_regions(text[]) from public, anon, authenticated;
grant execute on function public.set_my_ride_regions(text[]) to authenticated;

-- B4. HQ (Boss) sets any rider's regions, with the same checks.
create or replace function public.admin_set_rider_regions(p_rider uuid, p_regions text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.user_has_role('admin') then
    raise exception 'Only admins can change a rider''s regions.' using errcode = '42501';
  end if;
  perform public.replace_rider_regions(p_rider, p_regions);
end;
$$;
revoke all on function public.admin_set_rider_regions(uuid, text[]) from public, anon, authenticated;
grant execute on function public.admin_set_rider_regions(uuid, text[]) to authenticated;

notify pgrst, 'reload schema';

commit;


-- ============================================================================
-- CHECKS AFTER PART A (read only). Paste one at a time into the SQL editor.
--
-- 1. Exactly 16 readable kitchens columns per role (expect anon 16, authenticated 16):
-- select grantee, count(*) from information_schema.column_privileges where table_schema = 'public' and table_name = 'kitchens' and privilege_type = 'SELECT' and grantee in ('anon', 'authenticated') group by grantee order by grantee;
--
-- 2. The 5 private columns are still not granted (expect no rows):
-- select grantee, column_name from information_schema.column_privileges where table_schema = 'public' and table_name = 'kitchens' and privilege_type = 'SELECT' and grantee in ('anon', 'authenticated') and column_name in ('paynow_type', 'paynow_value', 'latitude', 'longitude', 'acknowledged_terms_at');
--
-- 3. Still no table-wide SELECT on kitchens (expect no rows):
-- select grantee from information_schema.table_privileges where table_schema = 'public' and table_name = 'kitchens' and privilege_type = 'SELECT' and grantee in ('anon', 'authenticated');
--
-- 4. Kitchens per region (NULL = no postal code or an unmapped sector):
-- select region, count(*) from public.kitchens group by region order by region;
--
-- 5. A live kitchen with a mapped postal code but no region (expect no rows):
-- select k.id from public.kitchens k join public.kitchen_addresses ka on ka.kitchen_id = k.id join public.postal_sector_regions r on r.sector = left(ka.postal_code, 2) where k.is_live and k.region is distinct from r.region;
--
-- 6. Sectors per region (expect east 24, north 10, south 30, west 17; 81 in all):
-- select region, count(*) from public.postal_sector_regions group by region order by region;
--
-- 7. As a signed-out visitor:
--   begin; set local role anon;
--   select id, business_name, region from public.kitchens limit 3;   -- works
--   select latitude from public.kitchens limit 1;                    -- permission denied
--   select * from public.kitchens limit 1;                           -- permission denied
--   rollback;
--
-- CHECKS AFTER PART B (read only)
--
-- 8. rider_regions: authenticated may only SELECT, anon nothing (expect one row, authenticated SELECT):
-- select grantee, privilege_type from information_schema.table_privileges where table_schema = 'public' and table_name = 'rider_regions' and grantee in ('anon', 'authenticated') order by grantee, privilege_type;
--
-- 9. Who may call the region functions, directly or through PUBLIC (expect exactly admin_set_rider_regions and set_my_ride_regions, authenticated only):
-- select p.proname, r.rolname from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join pg_roles r where n.nspname = 'public' and p.proname in ('set_kitchen_region', 'resync_kitchen_regions', 'replace_rider_regions', 'set_my_ride_regions', 'admin_set_rider_regions') and r.rolname in ('anon', 'authenticated') and has_function_privilege(r.oid, p.oid, 'EXECUTE') order by 1, 2;
--
-- 10. Every region function runs with an empty search_path (expect no rows):
-- select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('set_kitchen_region', 'resync_kitchen_regions', 'replace_rider_regions', 'set_my_ride_regions', 'admin_set_rider_regions') and not coalesce(p.proconfig, '{}') @> array['search_path=""'];
--
-- 11. Riders per region (a rider in 2 regions counts in both):
-- select region, count(*) from public.rider_regions group by region order by region;
-- ============================================================================


-- ============================================================================
-- UNDO (only after the apps stop naming region, rider_regions and the
-- functions). Undo Part B first, then Part A, each in one transaction.
--
-- UNDO PART B:
--   begin;
--   drop function if exists public.admin_set_rider_regions(uuid, text[]);
--   drop function if exists public.set_my_ride_regions(text[]);
--   drop function if exists public.replace_rider_regions(uuid, text[]);
--   drop table if exists public.rider_regions;
--   commit;
--
-- UNDO PART A:
--   begin;
--   revoke select (region) on public.kitchens from anon, authenticated;
--   drop trigger if exists before_kitchen_region on public.kitchens;
--   drop trigger if exists after_postal_sector_regions_change on public.postal_sector_regions;
--   drop function if exists public.set_kitchen_region();
--   drop function if exists public.resync_kitchen_regions();
--   alter table public.kitchens drop column if exists region;
--   drop table if exists public.postal_sector_regions;
--   drop table if exists public.regions;
--   commit;
-- ============================================================================

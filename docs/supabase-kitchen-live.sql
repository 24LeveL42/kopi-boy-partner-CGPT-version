-- ============================================================================
-- KOPI BOY — "Your kitchen is live!" pop-up (Partner app, cooks)
--
-- One transaction, safe to re-run. RUN ORDER: after docs/supabase-schema.sql
-- (needs profiles, kitchens and the "Users can update their own profile"
-- policy). Independent of docs/supabase-approval-celebration.sql.
--
-- profiles.kitchen_live_seen: false until the cook has closed the one-time
-- "Your kitchen is live!" pop-up shown after their first kitchen save. The
-- Partner app sets it to true itself (the cook updating their own row).
--
-- Who can change it: the existing "Users can update their own profile"
-- policy (own row only) and the table-wide UPDATE grant below. The
-- protect_profile_privileges trigger (schema section 5) only locks role and
-- is_active. Nothing here changes RLS, that trigger, or role / is_active.
--
-- Until this file has run, the app treats the missing column as "already
-- seen" and shows nothing, so the code can ship first.
-- ============================================================================

begin;

alter table public.profiles
  add column if not exists kitchen_live_seen boolean not null default false;

-- Backfill: every cook with a saved kitchen today never sees the pop-up.
-- ONCE only: a re-run must not cancel it for a cook who saved their first
-- kitchen after the first run and hasn't closed the pop-up yet, so the
-- column's comment records that this has been done.
do $$
begin
  if coalesce(col_description('public.profiles'::regclass,
       (select attnum from pg_attribute
         where attrelid = 'public.profiles'::regclass and attname = 'kitchen_live_seen')), '')
     not like '%[kitchens backfilled]%' then
    update public.profiles p
       set kitchen_live_seen = true
     where not p.kitchen_live_seen
       and exists (select 1 from public.kitchens k where k.id = p.id);
    comment on column public.profiles.kitchen_live_seen is
      'One-time "Your kitchen is live!" pop-up closed (Partner app). [kitchens backfilled]';
  end if;
end $$;

-- Already granted table-wide in docs/supabase-schema.sql section 1; restated
-- so this file stands alone. Row access is still the own-row policy.
grant select, update on public.profiles to authenticated;

commit;

-- ----------------------------------------------------------------------------
-- CHECKS (read only). Paste one at a time into the SQL editor.
-- ----------------------------------------------------------------------------
-- 1. The column exists, not null, default false:
-- select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'kitchen_live_seen';
-- 2. Cooks with a kitchen still waiting for the pop-up (expect none right after the first run):
-- select p.id, p.full_name from public.profiles p join public.kitchens k on k.id = p.id where not p.kitchen_live_seen;
-- 3. The one-time backfill has run (expect the comment to end in [kitchens backfilled]):
-- select col_description('public.profiles'::regclass, attnum) from pg_attribute where attrelid = 'public.profiles'::regclass and attname = 'kitchen_live_seen';

-- ----------------------------------------------------------------------------
-- TESTING: show the pop-up again for one test cook (their kitchen must be
-- live and not blocked). Check the name matches exactly one person first.
-- ----------------------------------------------------------------------------
-- select id, full_name, role from public.profiles where full_name ilike '%your test cook name%';
-- update public.profiles set kitchen_live_seen = false where full_name ilike '%your test cook name%';

-- ----------------------------------------------------------------------------
-- UNDO (only after the Partner app stops reading kitchen_live_seen):
-- ----------------------------------------------------------------------------
-- alter table public.profiles drop column if exists kitchen_live_seen;

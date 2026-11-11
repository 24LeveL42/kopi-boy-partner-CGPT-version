-- ============================================================================
-- KOPI BOY — "You're approved" celebration (Partner app, cooks and riders)
--
-- One transaction, safe to re-run. RUN ORDER: after docs/supabase-schema.sql
-- (needs profiles, kitchens, rider_applications and the "Users can update
-- their own profile" policy). Run it BEFORE deploying the Partner app code
-- that celebrates riders, or every existing rider sees the celebration once.
--
-- profiles.approval_celebrated: false until the cook or rider has seen the
-- one-time confetti + "You're approved!" card. The Partner app sets it to
-- true itself (the user updating their own row) when the card appears.
-- Pickers (retired role) never reach the screens that show it.
--
-- Who can change it: the existing "Users can update their own profile"
-- policy (own row only) and the table-wide UPDATE grant below. The
-- protect_profile_privileges trigger (schema section 5) only locks role and
-- is_active, so it leaves this column alone. Nothing here changes RLS, that
-- trigger, or role / is_active.
--
-- Until this file has run, the app treats the missing column as "already
-- celebrated" and shows nothing.
-- ============================================================================

begin;

alter table public.profiles
  add column if not exists approval_celebrated boolean not null default false;

-- Cooks: those who already saved a kitchen have clearly opened the app since
-- approval, so they don't get the celebration. Approved cooks with no kitchen
-- yet still do. Safe on every run: a cook who hasn't seen it has no kitchen.
update public.profiles p
   set approval_celebrated = true
 where not p.approval_celebrated
   and exists (select 1 from public.kitchens k where k.id = p.id);

-- Riders: every rider who exists today doesn't get it — role 'rider', or
-- still 'customer' with an approved rider application (the app sends those
-- to the rider dashboard too). ONCE only: a re-run must not cancel the
-- celebration for riders approved after the first run, so the column's
-- comment records that this has been done.
do $$
begin
  if coalesce(col_description('public.profiles'::regclass,
       (select attnum from pg_attribute
         where attrelid = 'public.profiles'::regclass and attname = 'approval_celebrated')), '')
     not like '%[riders backfilled]%' then
    update public.profiles p
       set approval_celebrated = true
     where not p.approval_celebrated
       and (p.role = 'rider'
            or (p.role = 'customer'
                and exists (select 1 from public.rider_applications r
                             where r.user_id = p.id and r.status = 'approved')));
    comment on column public.profiles.approval_celebrated is
      'One-time "You''re approved" celebration seen (Partner app). [riders backfilled]';
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
-- select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'approval_celebrated';
-- 2. Cooks and riders still waiting for their celebration (expect none of today's riders):
-- select id, full_name, role from public.profiles where role in ('cook', 'rider') and not approval_celebrated;
-- 3. The one-time rider backfill has run (expect the comment to end in [riders backfilled]):
-- select col_description('public.profiles'::regclass, attnum) from pg_attribute where attrelid = 'public.profiles'::regclass and attname = 'approval_celebrated';

-- ----------------------------------------------------------------------------
-- TESTING: replay the celebration for one test cook or rider. Check the name
-- matches exactly one person first (ilike '%...%' also matches longer
-- names), then run the update.
-- ----------------------------------------------------------------------------
-- select id, full_name, role from public.profiles where full_name ilike '%your test cook name%';
-- update public.profiles set approval_celebrated = false where full_name ilike '%your test cook name%';

-- ----------------------------------------------------------------------------
-- UNDO (only after the Partner app stops reading approval_celebrated):
-- ----------------------------------------------------------------------------
-- alter table public.profiles drop column if exists approval_celebrated;

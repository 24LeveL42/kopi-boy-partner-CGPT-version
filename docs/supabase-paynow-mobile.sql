-- ============================================================================
-- KOPI BOY — PayNow mobile number on cook applications (Partner app sign-up)
--
-- One transaction, safe to re-run. ADDITIVE ONLY: one new nullable column, one
-- new insert trigger. Nothing is dropped, no existing row is changed, no RLS
-- policy or grant is changed.
--
-- RUN ORDER: after docs/supabase-schema.sql. Run it BEFORE deploying the
-- Partner app release that has the two PayNow boxes (if the app ships first,
-- the form still submits, but the mobile number is not saved — see
-- insertApplication in src/components/ApplyForm.tsx).
--
-- The cook application form now asks for a PayNow mobile number and/or a
-- PayNow UEN (at least one; the app checks that). The UEN keeps using the
-- existing cook_applications.paynow_uen column; the mobile number goes in the
-- new paynow_mobile column, stored as 8 digits (no +65).
--
-- Payment is NOT read from here. Customers are shown kitchens.paynow_type /
-- paynow_value (get_order_paynow), which the cook saves in Kitchen Setup. The
-- app only uses these application values to pre-fill first-time Kitchen
-- Setup (UEN if given, else the mobile number). Existing kitchens, and
-- existing applications, are untouched.
--
-- Who can write it: the existing "Applicants can submit a cook application"
-- INSERT policy and the table-level grant (schema section 2) already cover a
-- new column. Applicants have no UPDATE policy, so insert is the only way
-- they write it.
--
-- The trigger is BEFORE INSERT only (like check_cook_application_uen in
-- schema section 26), so HQ approving or rejecting an older application is
-- never affected. It normalises the mobile number and rejects a malformed
-- one; it only trims paynow_uen (older applications sent free text there, and
-- an older copy of the app may still be open in someone's browser).
-- "At least one of the two" is enforced by the app, not here, for the same
-- reason.
-- ============================================================================

begin;

alter table public.cook_applications add column if not exists paynow_mobile text;

comment on column public.cook_applications.paynow_mobile is
  'PayNow mobile number given at sign-up: 8 digits starting with 8 or 9, no +65. Only pre-fills Kitchen Setup; customers are shown kitchens.paynow_type/paynow_value.';

create or replace function public.check_cook_application_paynow()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mobile text := regexp_replace(coalesce(new.paynow_mobile, ''), '[[:space:]().-]', '', 'g');
begin
  if v_mobile like '+65%' then
    v_mobile := substr(v_mobile, 4);
  elsif v_mobile like '65%' and length(v_mobile) = 10 then
    v_mobile := substr(v_mobile, 3);
  end if;

  new.paynow_mobile := nullif(v_mobile, '');
  if new.paynow_mobile is not null and new.paynow_mobile !~ '^[89][0-9]{7}$' then
    raise exception 'Your PayNow mobile number should be 8 digits starting with 8 or 9 (e.g. 91234567).' using errcode = '23514';
  end if;

  new.paynow_uen := nullif(btrim(coalesce(new.paynow_uen, '')), '');
  return new;
end;
$$;

revoke all on function public.check_cook_application_paynow() from public, anon, authenticated;

drop trigger if exists before_cook_application_paynow on public.cook_applications;
create trigger before_cook_application_paynow
  before insert on public.cook_applications
  for each row execute function public.check_cook_application_paynow();

commit;

-- CHECK (read-only), after running:
-- select column_name, is_nullable, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'cook_applications' and column_name = 'paynow_mobile';
-- select tgname from pg_trigger where tgrelid = 'public.cook_applications'::regclass and not tgisinternal;

-- UNDO (only if needed; keeps the column and any numbers already saved):
-- drop trigger if exists before_cook_application_paynow on public.cook_applications;
-- drop function if exists public.check_cook_application_paynow();

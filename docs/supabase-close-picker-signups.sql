-- ============================================================================
-- KOPI BOY 2.0 — Picker sign-ups are closed
-- Run this in the Supabase SQL Editor AFTER docs/supabase-schema.sql.
-- Safe to re-run. Changes no data and drops nothing.
--
-- Kopi Boy no longer has a picker role; the Partner app no longer offers it.
-- But partner sign-ups are inserted straight from the browser, and the
-- "Applicants can submit a picker application" policy still lets any
-- signed-in user insert into public.picker_applications with a hand-made
-- request. An app-side check can't stop that, so this trigger refuses every
-- new picker application in the database itself.
--
-- Left exactly as they are, on purpose: the 'picker' role value, the
-- picker_applications / pickup_requests / pickup_messages tables, their
-- columns, policies and other triggers, and every existing row.
--
-- The SQL Editor / service role (auth.uid() is null) is not blocked, so HQ
-- can still repair data by hand if ever needed.
-- ============================================================================

create or replace function public.refuse_picker_application()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  raise exception 'Kopi Boy partners can sign up as a cook or a rider.' using errcode = '42501';
end;
$$;

revoke all on function public.refuse_picker_application() from public, anon, authenticated;

drop trigger if exists refuse_picker_application on public.picker_applications;
create trigger refuse_picker_application
  before insert on public.picker_applications
  for each row execute function public.refuse_picker_application();

-- ----------------------------------------------------------------------------
-- HOW TO CHECK IT'S WORKING
--   As any signed-in user, POST to /rest/v1/picker_applications
--   {"user_id": "<your id>"} -> refused with
--   "Kopi Boy partners can sign up as a cook or a rider."
--   Existing rows are untouched:
--     select status, count(*) from public.picker_applications group by status;
-- ----------------------------------------------------------------------------

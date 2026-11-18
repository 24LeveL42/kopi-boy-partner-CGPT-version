-- ============================================================================
-- Email code sign-in: two new sign-up funnel events (Partner app)
--
-- Adds to the anonymous sign-in funnel (docs/supabase-registration-tracking.sql):
--   * email_code_sent   an in-app-browser visitor was emailed a sign-in code
--   * email_code_error  sending or checking it failed, with one short code:
--       invalid_email, no_account, rate_limited, send_failed,
--       code_rejected (wrong or expired code), verify_failed
-- Still no personal data: never the email address or the code typed.
--
-- Run once in the Supabase SQL editor, after supabase-registration-tracking.sql.
-- Safe to run twice. Until it runs, the app works normally: the function
-- just drops the two new events (it drops anything not on its lists).
--
-- What it changes: the two allowed-value checks on registration_events
-- (re-created with the longer lists; existing rows all still pass) and
-- log_registration_events() (same function, longer lists). Grants, policy,
-- table rows and the unique index are untouched.
-- ============================================================================

begin;

-- Drop the current checks on event_type and error_code, whatever they are
-- named, so no older, shorter list is left behind to reject the new events.
do $$
declare
  c record;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.registration_events'::regclass
       and con.contype = 'c'
       and (pg_get_constraintdef(con.oid) like '%event_type%' or pg_get_constraintdef(con.oid) like '%error_code%')
  loop
    execute format('alter table public.registration_events drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.registration_events add constraint registration_events_event_type_check
  check (event_type in (
    'signin_view', 'in_app_browser', 'chose_sign_up', 'chose_sign_in', 'signin_click',
    'signin_error', 'existing_account', 'email_code_sent', 'email_code_error',
    'page_view', 'cook_form_view', 'rider_form_view', 'form_start', 'field_reached',
    'submit_attempt', 'validation_error', 'submit_success', 'abandon'
  ));

alter table public.registration_events add constraint registration_events_error_code_check
  check (error_code in (
    '', 'required', 'invalid_format', 'invalid_postal_code', 'invalid_business_uen',
    'paynow_missing', 'invalid_mobile', 'invalid_uen', 'privacy_required', 'server_error',
    'google_error', 'auth_failed', 'google_slow',
    'invalid_email', 'no_account', 'rate_limited', 'send_failed', 'code_rejected', 'verify_failed'
  ));

-- Same as in docs/supabase-registration-tracking.sql (kept identical by
-- src/lib/registration-sql.test.ts). create or replace keeps the existing
-- grants (execute for anon and authenticated).
create or replace function public.log_registration_events(
  p_session_id uuid,
  p_form text,
  p_is_test boolean,
  p_events jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_test boolean;
begin
  if p_session_id is null
     or p_form is distinct from 'cook'
     or jsonb_typeof(p_events) is distinct from 'array'
     or jsonb_array_length(p_events) = 0
     or jsonb_array_length(p_events) > 20 then
    return;
  end if;

  if (select count(*) from public.registration_events where session_id = p_session_id) >= 60 then
    return;
  end if;

  v_is_test := coalesce(p_is_test, false)
    or (auth.uid() is not null and public.user_has_role('admin'));

  insert into public.registration_events (session_id, form, event_type, field, step, error_code, is_test)
  select p_session_id,
         p_form,
         e ->> 'event',
         coalesce(e ->> 'field', ''),
         case when (e ->> 'step') ~ '^[0-9]{1,2}$' and (e ->> 'step')::int between 1 and 20
              then (e ->> 'step')::smallint end,
         coalesce(e ->> 'code', ''),
         v_is_test
    from jsonb_array_elements(p_events) as e
   where jsonb_typeof(e) = 'object'
     and (e ->> 'event') in (
       'signin_view', 'in_app_browser', 'chose_sign_up', 'chose_sign_in', 'signin_click',
       'signin_error', 'existing_account', 'email_code_sent', 'email_code_error',
       'page_view', 'cook_form_view', 'rider_form_view', 'form_start', 'field_reached',
       'submit_attempt', 'validation_error', 'submit_success', 'abandon')
     and coalesce(e ->> 'field', '') in (
       '', 'full_name', 'contact_number', 'business_name', 'business_type', 'business_uen',
       'business_address', 'postal_code', 'paynow_mobile', 'paynow_uen', 'privacy_ack')
     and coalesce(e ->> 'code', '') in (
       '', 'required', 'invalid_format', 'invalid_postal_code', 'invalid_business_uen',
       'paynow_missing', 'invalid_mobile', 'invalid_uen', 'privacy_required', 'server_error',
       'google_error', 'auth_failed', 'google_slow',
       'invalid_email', 'no_account', 'rate_limited', 'send_failed', 'code_rejected', 'verify_failed')
  on conflict do nothing;
end;
$$;

commit;

-- CHECK (read-only), after running:
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conrelid = 'public.registration_events'::regclass and contype = 'c' order by 1;
--   → event_type check lists email_code_sent and email_code_error;
--     error_code check lists invalid_email … verify_failed.
-- select grantee from information_schema.routine_privileges
--  where routine_name = 'log_registration_events' order by 1;
--   → still anon and authenticated (plus postgres / service_role).

-- UNDO (only if needed): run the previous docs/supabase-registration-tracking.sql
-- function from git history; the wider checks can stay (they only allow more).

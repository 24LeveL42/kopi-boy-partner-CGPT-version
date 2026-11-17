-- ============================================================================
-- KOPI BOY — Cook registration funnel tracking (Partner app sign-up)
--
-- FUNNEL: sign-in screen (signed out) → Google → partner sign-up (role
-- choice) → cook form → submitted. One anonymous session id per browser tab
-- carries through the Google round-trip, so a session's rows tell where it
-- stopped:
--   * signin_view, no signin_click          → left before Google
--   * signin_click, no page_view and no
--     existing_account                      → left at (or failed) Google
--   * existing_account                      → an existing partner signing
--                                             back in: not a new sign-up
--   * page_view → cook_form_view → form_start / field_reached → submit_success
-- The sign-in screen is shared with rider applicants: rider_form_view marks
-- them after sign-in.
--
-- One transaction, safe to re-run. ADDITIVE ONLY: one new table, one new
-- function. Nothing existing is changed or dropped.
--
-- RUN ORDER: after docs/supabase-schema.sql (needs public.user_has_role).
-- The app can ship before or after this file: until it has run, the app's
-- tracking calls fail silently and registration works as normal.
--
-- WHAT IS STORED: an anonymous random session id (one per browser tab; not
-- the user id, not linked to the account), the event type, and optionally a
-- field NAME, its step number, and a short error code. The allowed values
-- are fixed lists below, so nothing a cook types can be stored here. No IP,
-- no user agent, no user id: the function writes only the listed columns.
--
-- WHO CAN DO WHAT:
--   * anon / authenticated: may only CALL log_registration_events(). They
--     have no INSERT/UPDATE/DELETE/SELECT privilege on the table at all, so
--     they can never read events, or write anything outside the fixed lists.
--   * Boss admins (profiles.role = 'admin'): may SELECT (for the Phase 2
--     report). Nobody can UPDATE or DELETE through the API.
--
-- COST (Supabase spend cap): the app batches events (one call every few
-- seconds at most, or when the tab is hidden/closed), sends each event once
-- per session, and the function also caps a call at 20 events and a session
-- at 60 rows. A full sign-up is roughly 15–20 rows over 2–5 calls.
--
-- DUPLICATES: one row per (session, event, field, error code) — a unique
-- index plus ON CONFLICT DO NOTHING, so a reload or a resend never counts
-- twice.
--
-- TEST SESSIONS: is_test is true when the app says so (localhost, dev
-- builds, a device marked with ?kb_test=1, or an HQ account signing in —
-- which also marks that device as test from then on) or when the caller is
-- signed in as an admin. Reports must leave out every session that has ANY
-- is_test row (an admin's sign-in screen rows are sent before the app knows
-- it's an admin).
--
-- ABANDONED (for the Phase 2 report; 30 minutes approved): a session with
-- form_start, no submit_success, and no event in the last 30 minutes. An explicit 'abandon'
-- row (tab closed mid-form) also records the last field touched.
-- ============================================================================

begin;

create table if not exists public.registration_events (
  id bigint generated always as identity primary key,
  session_id uuid not null,
  form text not null default 'cook' check (form in ('cook')),
  -- Same list as RegistrationEventType in src/lib/registration-tracking.ts.
  event_type text not null check (event_type in (
    'signin_view', 'in_app_browser', 'chose_sign_up', 'chose_sign_in', 'signin_click',
    'signin_error', 'existing_account',
    'page_view', 'cook_form_view', 'rider_form_view', 'form_start', 'field_reached',
    'submit_attempt', 'validation_error', 'submit_success', 'abandon'
  )),
  -- '' = not about a field. Same list as COOK_FORM_FIELDS in src/lib/registration-tracking.ts.
  field text not null default '' check (field in (
    '', 'full_name', 'contact_number', 'business_name', 'business_type', 'business_uen',
    'business_address', 'postal_code', 'paynow_mobile', 'paynow_uen', 'privacy_ack'
  )),
  step smallint check (step between 1 and 20),
  -- '' = no error. Same list as ValidationCode in src/lib/registration-tracking.ts.
  error_code text not null default '' check (error_code in (
    '', 'required', 'invalid_format', 'invalid_postal_code', 'invalid_business_uen',
    'paynow_missing', 'invalid_mobile', 'invalid_uen', 'privacy_required', 'server_error',
    'google_error', 'auth_failed', 'google_slow'
  )),
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.registration_events is
  'Anonymous cook sign-up funnel events (Partner app). No personal data: session id is random per tab; field names and error codes only. Written only via log_registration_events(); readable by admins only.';

create unique index if not exists registration_events_once
  on public.registration_events (session_id, form, event_type, field, error_code);
create index if not exists registration_events_created_at
  on public.registration_events (created_at);

alter table public.registration_events enable row level security;

-- New tables get ALL for anon/authenticated by default on Supabase; take it
-- all back, then give authenticated SELECT only (RLS below limits it to admins).
revoke all on public.registration_events from public, anon, authenticated;
grant select on public.registration_events to authenticated;

drop policy if exists "Admins can read registration events" on public.registration_events;
create policy "Admins can read registration events"
  on public.registration_events for select
  to authenticated
  using (public.user_has_role('admin'));

-- The only way in. SECURITY DEFINER so it can insert while callers have no
-- table privilege; it never raises on bad input (tracking must never show an
-- error), it just drops rows that aren't on the lists.
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
       'signin_error', 'existing_account',
       'page_view', 'cook_form_view', 'rider_form_view', 'form_start', 'field_reached',
       'submit_attempt', 'validation_error', 'submit_success', 'abandon')
     and coalesce(e ->> 'field', '') in (
       '', 'full_name', 'contact_number', 'business_name', 'business_type', 'business_uen',
       'business_address', 'postal_code', 'paynow_mobile', 'paynow_uen', 'privacy_ack')
     and coalesce(e ->> 'code', '') in (
       '', 'required', 'invalid_format', 'invalid_postal_code', 'invalid_business_uen',
       'paynow_missing', 'invalid_mobile', 'invalid_uen', 'privacy_required', 'server_error',
       'google_error', 'auth_failed', 'google_slow')
  on conflict do nothing;
end;
$$;

revoke all on function public.log_registration_events(uuid, text, boolean, jsonb) from public;
grant execute on function public.log_registration_events(uuid, text, boolean, jsonb) to anon, authenticated;

commit;

-- CHECK (read-only), after running:
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'registration_events' order by 1, 2;
--   → expect only authenticated / SELECT (plus postgres / service_role).
-- select policyname, cmd from pg_policies where tablename = 'registration_events';
--   → expect one SELECT policy.

-- UNDO (only if needed; stops new events, keeps the ones already recorded):
-- revoke execute on function public.log_registration_events(uuid, text, boolean, jsonb) from anon, authenticated;

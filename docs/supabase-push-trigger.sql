-- ============================================================================
-- KOPI BOY 2.0 — Push webhook WITHOUT the dashboard "Database Webhooks" feature
-- Run this in the Supabase SQL Editor AFTER docs/supabase-notifications.sql.
--
-- Use this when Dashboard > Database > Webhooks fails (e.g. "schema
-- supabase_functions does not exist"). It does exactly what that webhook
-- would: after every INSERT into public.notifications it POSTs the row to the
-- Partner app's /api/push/send, using the pg_net extension directly.
--
-- BEFORE YOU RUN: edit the two values in step 3 (your Vercel domain, and the
-- same PUSH_WEBHOOK_SECRET you put in Vercel). Safe to re-run to change them.
-- ============================================================================

-- 1. pg_net does the HTTP call. (Already enabled if you ran it earlier.)
create extension if not exists pg_net;

-- 2. Where the URL + secret live. A private schema that the API never exposes,
--    with no access for anon / authenticated — only the database owner (and so
--    the trigger function below) can read the secret.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.push_webhook_config (
  id boolean primary key default true check (id), -- exactly one row
  url text not null check (url like 'https://%' and url not like '%YOUR-DOMAIN%'),
  secret text not null check (secret <> 'PASTE_PUSH_WEBHOOK_SECRET_HERE' and length(secret) >= 16)
);
revoke all on table private.push_webhook_config from public, anon, authenticated;

-- 3. >>> EDIT THESE TWO VALUES <<<
insert into private.push_webhook_config (id, url, secret)
values (
  true,
  'https://YOUR-DOMAIN/api/push/send',          -- e.g. https://kopi-boy-partner.vercel.app/api/push/send
  'PASTE_PUSH_WEBHOOK_SECRET_HERE'              -- same value as PUSH_WEBHOOK_SECRET in Vercel / .env.local
)
on conflict (id) do update set url = excluded.url, secret = excluded.secret;

-- 4. The trigger. pg_net queues the request and sends it after the transaction
--    commits, so it never slows down or blocks the order/delivery write that
--    caused the notification. The exception block means even a pg_net failure
--    can't roll that write back.
create or replace function private.send_push_webhook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg record;
begin
  begin
    select url, secret into cfg from private.push_webhook_config;
    if found then
      perform net.http_post(
        url := cfg.url,
        body := jsonb_build_object(
          'type', 'INSERT',
          'table', 'notifications',
          'schema', 'public',
          'record', to_jsonb(new),
          'old_record', null
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-webhook-secret', cfg.secret
        ),
        timeout_milliseconds := 5000
      );
    end if;
  exception when others then
    raise warning 'send_push_webhook failed: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function private.send_push_webhook() from public, anon, authenticated;

drop trigger if exists push_on_notification on public.notifications;
create trigger push_on_notification
  after insert on public.notifications
  for each row execute function private.send_push_webhook();

-- ----------------------------------------------------------------------------
-- HOW TO CHECK IT'S WORKING
-- After a notification is created (e.g. place a test order), run:
--
--   select id, status_code, error_msg, left(content, 120) as response
--   from net._http_response order by created desc limit 5;
--
--   200  = the app accepted it (push sent)      401 = secret doesn't match Vercel's
--   503  = Vercel env vars missing / not redeployed      (empty table = nothing sent yet)
-- ----------------------------------------------------------------------------

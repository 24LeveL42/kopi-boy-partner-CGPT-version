-- ============================================================================
-- KOPI BOY 2.0 — Notifications (in-app inbox + Web Push + reminders)
-- Run this ONCE, after every script in supabase-schema.sql, in the same
-- Supabase project's SQL Editor (Dashboard > SQL Editor > New query > paste
-- this whole file > Run).
--
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS, DROP ... IF
-- EXISTS before CREATE, CREATE OR REPLACE for functions).
--
-- HOW IT WORKS
-- Notifications are written by DATABASE TRIGGERS on orders, delivery_requests,
-- pickup_requests, the three *_applications tables and profiles — so they fire
-- no matter WHICH app made the change (Customer app places an order, HQ
-- approves an application, Partner app accepts a delivery). None of those apps
-- need code changes.
--
-- Every trigger body is wrapped in an EXCEPTION block: a notification failure
-- must never roll back the real business write (e.g. a customer's order).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. NOTIFICATIONS (the inbox)
-- One row per notification per recipient. Rows are only ever created by the
-- security-definer trigger functions below (never by the browser), so
-- authenticated gets select + update(read_at) and nothing else.
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('orders', 'deliveries', 'pickups', 'account')),
  type text not null,
  title text not null,
  body text,
  url text not null default '/',
  ref_id uuid, -- the order / request the notification is about (used to dedupe reminders)
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_type_ref_idx
  on public.notifications (type, ref_id);

alter table public.notifications enable row level security;

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

drop policy if exists "Users can read their own notifications" on public.notifications;
create policy "Users can read their own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

drop policy if exists "Users can mark their own notifications read" on public.notifications;
create policy "Users can mark their own notifications read"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 2. NOTIFICATION PREFERENCES
-- One optional row per user. No row = everything on. `account` alerts
-- (approved / rejected / blocked) can't be muted. on_duty is for riders and
-- pickers: off = don't broadcast new requests to me.
-- ----------------------------------------------------------------------------
create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  orders boolean not null default true,
  deliveries boolean not null default true,
  pickups boolean not null default true,
  sound boolean not null default true,
  on_duty boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

grant select, insert, update on public.notification_preferences to authenticated;

drop policy if exists "Users can read their own notification preferences" on public.notification_preferences;
create policy "Users can read their own notification preferences"
  on public.notification_preferences for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own notification preferences" on public.notification_preferences;
create policy "Users can create their own notification preferences"
  on public.notification_preferences for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own notification preferences" on public.notification_preferences;
create policy "Users can update their own notification preferences"
  on public.notification_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 3. PUSH SUBSCRIPTIONS (one per browser/device)
-- The browser's Web Push endpoint + keys. Read only by the Partner app's
-- server-side sender (service-role key); users manage theirs through the two
-- RPCs below. No direct insert/update grant: a browser that switches account
-- must be able to take over its own endpoint, which RLS alone can't express.
-- ----------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

grant select, delete on public.push_subscriptions to authenticated;
-- The Partner app's server-side sender (/api/push/send) reads these with the
-- service-role key. service_role skips RLS but NOT table grants, and newer
-- Supabase projects don't grant it automatically — without this the sender
-- fails with "permission denied for table push_subscriptions".
grant select, delete on public.push_subscriptions to service_role;

drop policy if exists "Users can read their own push subscriptions" on public.push_subscriptions;
create policy "Users can read their own push subscriptions"
  on public.push_subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists "Users can delete their own push subscriptions" on public.push_subscriptions;
create policy "Users can delete their own push subscriptions"
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);

-- Registers (or re-assigns) this browser's subscription to the caller.
create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent;
end;
$$;

-- Removes this browser's subscription — only if it belongs to the caller.
create or replace function public.unregister_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_subscriptions
  where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.unregister_push_subscription(text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.unregister_push_subscription(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. REALTIME
-- Lets the app subscribe to changes (RLS still applies to what each user
-- receives). notifications drives toasts / the bell; the others let the
-- dashboards update themselves without tapping Refresh.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['notifications', 'orders', 'delivery_requests', 'pickup_requests']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 5. HELPERS
-- ----------------------------------------------------------------------------
create or replace function public.short_id(p_id uuid)
returns text
language sql
immutable
as $$ select upper(left(p_id::text, 8)); $$;

-- Writes one notification, unless the recipient has muted that category.
-- Internal only: callers are the trigger functions below, never the browser.
create or replace function public.notify_user(
  p_user uuid,
  p_category text,
  p_type text,
  p_title text,
  p_body text,
  p_url text default '/',
  p_ref uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean := true;
begin
  if p_user is null then
    return;
  end if;

  if p_category <> 'account' then
    select case p_category
             when 'orders' then orders
             when 'deliveries' then deliveries
             when 'pickups' then pickups
             else true
           end
      into v_enabled
      from public.notification_preferences
     where user_id = p_user;
    if found and not v_enabled then
      return;
    end if;
  end if;

  insert into public.notifications (user_id, category, type, title, body, url, ref_id)
  values (p_user, p_category, p_type, p_title, p_body, p_url, p_ref);
end;
$$;

revoke all on function public.notify_user(uuid, text, text, text, text, text, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. ORDERS -> cook
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_order_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  begin
    if tg_op = 'INSERT' then
      perform public.notify_user(
        new.kitchen_id, 'orders', 'order_placed', 'New order',
        'Order #' || public.short_id(new.id) || ' · $' || to_char(new.subtotal, 'FM999990.00'),
        '/', new.id
      );

    elsif new.order_status = 'cancelled' and old.order_status is distinct from 'cancelled' then
      -- (only reached on UPDATE: the INSERT branch above already matched)
      perform public.notify_user(
        new.kitchen_id, 'orders', 'order_cancelled', 'Order cancelled',
        'Order #' || public.short_id(new.id) || ' was cancelled by the customer.',
        '/', new.id
      );
      -- A rider already on the way needs to know the food is no longer needed.
      for r in
        select id, rider_id from public.delivery_requests
        where order_id = new.id and status in ('accepted', 'release_requested') and rider_id is not null
      loop
        perform public.notify_user(
          r.rider_id, 'deliveries', 'delivery_cancelled', 'Delivery cancelled',
          'Order #' || public.short_id(new.id) || ' was cancelled — no need to collect it.',
          '/', r.id
        );
      end loop;
    end if;
  exception when others then
    raise warning 'notify_on_order_change failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists notify_on_order_change on public.orders;
create trigger notify_on_order_change
  after insert or update of order_status on public.orders
  for each row execute function public.notify_on_order_change();

-- ----------------------------------------------------------------------------
-- 7. DELIVERY REQUESTS -> riders (broadcast) and the cook
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_delivery_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k record;
  v_order text := public.short_id(new.order_id);
  v_broadcast boolean;
begin
  begin
    select business_name, postal_sector into k from public.kitchens where id = new.kitchen_id;

    -- Open (new, or re-opened): broadcast to every active rider who's on duty.
    -- (nested ifs, not `tg_op = 'INSERT' or old...`: OLD isn't assigned on INSERT
    -- and plpgsql doesn't guarantee short-circuiting)
    if tg_op = 'INSERT' then
      v_broadcast := new.status = 'open';
    else
      v_broadcast := new.status = 'open' and old.status is distinct from 'open';
    end if;

    if v_broadcast then
      insert into public.notifications (user_id, category, type, title, body, url, ref_id)
      select p.id, 'deliveries', 'delivery_open', 'New delivery request',
             coalesce(k.business_name, 'A kitchen') || coalesce(' · Postal sector ' || k.postal_sector, ''),
             '/', new.id
      from public.profiles p
      left join public.notification_preferences np on np.user_id = p.id
      where p.role = 'rider'
        and p.is_active
        and coalesce(np.deliveries, true)
        and coalesce(np.on_duty, true);
    end if;

    if tg_op = 'UPDATE' then
     if old.status is distinct from new.status then
      if new.status = 'accepted' then
        perform public.notify_user(
          new.kitchen_id, 'deliveries', 'delivery_accepted', 'Rider on the way',
          'A rider accepted the delivery for order #' || v_order || '.', '/', new.id
        );
      elsif new.status = 'completed' then
        perform public.notify_user(
          new.kitchen_id, 'deliveries', 'delivery_completed', 'Delivery completed',
          'Order #' || v_order || ' was delivered.', '/', new.id
        );
      elsif new.status = 'release_requested' then
        perform public.notify_user(
          new.kitchen_id, 'deliveries', 'delivery_released', 'Rider dropped the delivery',
          'Order #' || v_order || ' needs a new rider.', '/', new.id
        );
      elsif new.status = 'cancelled' and old.rider_id is not null then
        perform public.notify_user(
          old.rider_id, 'deliveries', 'delivery_cancelled', 'Delivery cancelled',
          'The delivery for order #' || v_order || ' was cancelled.', '/', new.id
        );
      end if;
     end if;
    end if;
  exception when others then
    raise warning 'notify_on_delivery_change failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists notify_on_delivery_change on public.delivery_requests;
create trigger notify_on_delivery_change
  after insert or update of status on public.delivery_requests
  for each row execute function public.notify_on_delivery_change();

-- ----------------------------------------------------------------------------
-- 8. PICKUP REQUESTS -> pickers (broadcast) and the rider
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_pickup_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k record;
  v_kitchen text;
  v_broadcast boolean;
begin
  begin
    select business_name, postal_sector into k from public.kitchens where id = new.kitchen_id;
    v_kitchen := coalesce(k.business_name, 'the kitchen');

    if tg_op = 'INSERT' then
      v_broadcast := new.status = 'open';
    else
      v_broadcast := new.status = 'open' and old.status is distinct from 'open';
    end if;

    if v_broadcast then
      insert into public.notifications (user_id, category, type, title, body, url, ref_id)
      select p.id, 'pickups', 'pickup_open', 'New pickup request',
             v_kitchen || coalesce(' · Postal sector ' || k.postal_sector, '')
               || ' · suggested $' || to_char(new.suggested_fee, 'FM990.00'),
             '/', new.id
      from public.profiles p
      left join public.notification_preferences np on np.user_id = p.id
      where p.role = 'picker'
        and p.is_active
        and coalesce(np.pickups, true)
        and coalesce(np.on_duty, true);
    end if;

    if tg_op = 'UPDATE' then
     if old.status is distinct from new.status then
      if new.status = 'accepted' then
        perform public.notify_user(
          new.rider_id, 'pickups', 'pickup_accepted', 'Picker accepted',
          'A picker is on the way to ' || v_kitchen || '.', '/request-picker', new.id
        );
      elsif new.status = 'completed' then
        perform public.notify_user(
          new.rider_id, 'pickups', 'pickup_completed', 'Handoff complete',
          'The picker handed over the food from ' || v_kitchen || '.', '/request-picker', new.id
        );
      elsif new.status = 'cancelled' and old.picker_id is not null then
        perform public.notify_user(
          old.picker_id, 'pickups', 'pickup_cancelled', 'Pickup cancelled',
          'The rider cancelled the pickup at ' || v_kitchen || '.', '/', new.id
        );
      end if;
     end if;
    end if;
  exception when others then
    raise warning 'notify_on_pickup_change failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists notify_on_pickup_change on public.pickup_requests;
create trigger notify_on_pickup_change
  after insert or update of status on public.pickup_requests
  for each row execute function public.notify_on_pickup_change();

-- ----------------------------------------------------------------------------
-- 9. APPLICATIONS -> the applicant (approved / rejected by HQ)
-- One function, three triggers; TG_TABLE_NAME says which role applied.
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_application_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next text;
begin
  begin
    if new.status is distinct from old.status and old.status = 'pending' then
      if new.status = 'approved' then
        v_next := case tg_table_name
          when 'cook_applications' then 'Open the app and set up your kitchen to go live.'
          when 'rider_applications' then 'You can now accept delivery requests.'
          else 'You can now accept pickup requests.'
        end;
        perform public.notify_user(
          new.user_id, 'account', 'application_approved', 'Application approved', v_next, '/', new.id
        );
      elsif new.status = 'rejected' then
        perform public.notify_user(
          new.user_id, 'account', 'application_rejected', 'Application not approved',
          'Contact Kopi Boy support if you''d like to know more or reapply.', '/', new.id
        );
      end if;
    end if;
  exception when others then
    raise warning 'notify_on_application_review failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists notify_on_cook_application_review on public.cook_applications;
create trigger notify_on_cook_application_review
  after update of status on public.cook_applications
  for each row execute function public.notify_on_application_review();

drop trigger if exists notify_on_rider_application_review on public.rider_applications;
create trigger notify_on_rider_application_review
  after update of status on public.rider_applications
  for each row execute function public.notify_on_application_review();

drop trigger if exists notify_on_picker_application_review on public.picker_applications;
create trigger notify_on_picker_application_review
  after update of status on public.picker_applications
  for each row execute function public.notify_on_application_review();

-- ----------------------------------------------------------------------------
-- 10. PROFILES -> blocked / reinstated by HQ
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_profile_active_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.is_active is distinct from old.is_active and new.role in ('cook', 'rider', 'picker') then
      if new.is_active then
        perform public.notify_user(
          new.id, 'account', 'account_reinstated', 'Account reinstated',
          'Your partner account is active again.', '/', null
        );
      else
        perform public.notify_user(
          new.id, 'account', 'account_blocked', 'Account temporarily blocked',
          'Contact Kopi Boy support for details.', '/', null
        );
      end if;
    end if;
  exception when others then
    raise warning 'notify_on_profile_active_change failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists notify_on_profile_active_change on public.profiles;
create trigger notify_on_profile_active_change
  after update of is_active on public.profiles
  for each row execute function public.notify_on_profile_active_change();

-- ----------------------------------------------------------------------------
-- 11. TIMED REMINDERS
-- Run every minute by pg_cron (scheduled at the bottom):
--   * a new order nobody accepted/rejected for 5 minutes -> nudge the cook
--   * a delivery request nobody accepted for 10 minutes -> warn the cook
-- Each fires once per order / request (deduped on type + ref_id).
-- ----------------------------------------------------------------------------
create or replace function public.send_notification_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select o.id, o.kitchen_id
    from public.orders o
    where o.order_status = 'placed'
      and o.created_at < now() - interval '5 minutes'
      and o.created_at > now() - interval '2 hours'
      and not exists (
        select 1 from public.notifications n where n.type = 'order_reminder' and n.ref_id = o.id
      )
  loop
    perform public.notify_user(
      r.kitchen_id, 'orders', 'order_reminder', 'Order waiting for you',
      'Order #' || public.short_id(r.id) || ' hasn''t been accepted or rejected yet.', '/', r.id
    );
  end loop;

  for r in
    select d.id, d.kitchen_id, d.order_id
    from public.delivery_requests d
    where d.status = 'open'
      and d.created_at < now() - interval '10 minutes'
      and d.created_at > now() - interval '2 hours'
      and not exists (
        select 1 from public.notifications n where n.type = 'delivery_no_rider' and n.ref_id = d.id
      )
  loop
    perform public.notify_user(
      r.kitchen_id, 'deliveries', 'delivery_no_rider', 'No rider yet',
      'Order #' || public.short_id(r.order_id) || ' has been waiting 10 minutes for a rider.', '/', r.id
    );
  end loop;
end;
$$;

revoke all on function public.send_notification_reminders() from public, anon, authenticated;

-- Schedule it. pg_cron ships with Supabase; if it isn't enabled yet, turn it
-- on in Dashboard > Database > Extensions and re-run this file. Everything
-- above works without it — only the two timed reminders need the schedule.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'kb-notification-reminders',
    '* * * * *',
    'select public.send_notification_reminders()'
  );
exception when others then
  raise notice 'pg_cron not available (%). Timed reminders are OFF until it is enabled — re-run this file after enabling it.', sqlerrm;
end $$;

-- Housekeeping: keep the inbox small. (Optional — uncomment to prune
-- notifications older than 30 days once a day.)
-- select cron.schedule('kb-notification-cleanup', '0 3 * * *',
--   $$delete from public.notifications where created_at < now() - interval '30 days'$$);

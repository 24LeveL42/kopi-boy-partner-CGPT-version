-- KOPI BOY — Blocked partners can message the admin + blocked riders can't
-- touch deliveries.
-- Run once in the SAME Supabase project used by the customer/partner/boss
-- apps, after docs/supabase-schema.sql (needs profiles, user_has_role() and
-- delivery_requests). Safe to re-run.
--
-- How blocking works (schema section 1/5): HQ sets profiles.is_active = false.
-- Admins are profiles.role = 'admin', checked through user_has_role('admin').
-- No reason for a block is stored anywhere.

-- ---------------------------------------------------------------------------
-- 1. ADMIN_MESSAGES
-- A partner (usually a blocked one) writes to HQ; HQ replies on the same row.
-- None of the policies below look at profiles.is_active, so a blocked user
-- can still send and read their own messages — that's the point.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  sender_role text,
  message text not null constraint admin_messages_message_length
    check (char_length(btrim(message)) between 1 and 500),
  admin_reply text,
  replied_at timestamptz,
  status text not null default 'open' constraint admin_messages_status_check
    check (status in ('open', 'replied', 'closed')),
  created_at timestamptz not null default now()
);

create index if not exists admin_messages_sender_created_idx
  on public.admin_messages (sender_id, created_at desc);

alter table public.admin_messages enable row level security;

-- select (own + admin), insert (own), update (admin only, via RLS) — no
-- delete grant, so nobody can delete through the API.
revoke all on public.admin_messages from anon;
grant select, insert, update on public.admin_messages to authenticated;

drop policy if exists "Users can send their own admin messages" on public.admin_messages;
create policy "Users can send their own admin messages"
  on public.admin_messages for insert
  to authenticated
  with check (sender_id = auth.uid());

drop policy if exists "Users can read their own admin messages" on public.admin_messages;
create policy "Users can read their own admin messages"
  on public.admin_messages for select
  to authenticated
  using (sender_id = auth.uid());

drop policy if exists "Admins can read every admin message" on public.admin_messages;
create policy "Admins can read every admin message"
  on public.admin_messages for select
  to authenticated
  using (public.user_has_role('admin'));

drop policy if exists "Admins can update every admin message" on public.admin_messages;
create policy "Admins can update every admin message"
  on public.admin_messages for update
  to authenticated
  using (public.user_has_role('admin'))
  with check (public.user_has_role('admin'));

-- ---------------------------------------------------------------------------
-- 2. INSERT GUARD + RATE LIMIT (5 messages per user per rolling 24 hours)
-- The server, not the client, decides sender_role, created_at, status and the
-- reply columns — otherwise a sender could backdate created_at to dodge the
-- limit or insert a row that already looks "replied".
-- The advisory lock serialises one user's concurrent inserts so two requests
-- in flight can't both see "4 sent" and land a 6th.
-- SECURITY DEFINER so the count and the role lookup never depend on RLS.
-- ---------------------------------------------------------------------------
create or replace function public.admin_messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent int;
begin
  new.message := btrim(new.message);
  new.sender_role := (select p.role from public.profiles p where p.id = new.sender_id);
  new.created_at := now();
  new.status := 'open';
  new.admin_reply := null;
  new.replied_at := null;

  perform pg_advisory_xact_lock(hashtext('admin_messages:' || new.sender_id::text));

  select count(*) into v_recent
  from public.admin_messages m
  where m.sender_id = new.sender_id
    and m.created_at > now() - interval '24 hours';

  if v_recent >= 5 then
    raise exception 'You can send up to 5 messages to the admin every 24 hours. Please wait for a reply or try again later.'
      using errcode = 'P0001', hint = 'admin_messages_rate_limit';
  end if;

  return new;
end;
$$;

drop trigger if exists admin_messages_before_insert on public.admin_messages;
create trigger admin_messages_before_insert
  before insert on public.admin_messages
  for each row execute function public.admin_messages_before_insert();

-- ---------------------------------------------------------------------------
-- 3. UPDATE GUARD (admins only reach this — RLS has no other update policy)
-- The original message stays exactly as sent. Writing a reply stamps
-- replied_at and moves an open message to 'replied', so the Boss app only has
-- to set admin_reply (it may still set status = 'closed' explicitly).
-- ---------------------------------------------------------------------------
create or replace function public.admin_messages_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.id := old.id;
  new.sender_id := old.sender_id;
  new.sender_role := old.sender_role;
  new.message := old.message;
  new.created_at := old.created_at;

  if new.admin_reply is distinct from old.admin_reply then
    if nullif(btrim(coalesce(new.admin_reply, '')), '') is null then
      new.admin_reply := null;
      new.replied_at := null;
    else
      new.admin_reply := btrim(new.admin_reply);
      new.replied_at := now();
      if new.status = 'open' then
        new.status := 'replied';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists admin_messages_before_update on public.admin_messages;
create trigger admin_messages_before_update
  before update on public.admin_messages
  for each row execute function public.admin_messages_before_update();

-- Live updates: the partner sees HQ's reply appear without reloading.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'admin_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.admin_messages';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. BLOCKED RIDERS CAN'T ACCEPT OR UPDATE DELIVERIES
-- Riders write delivery_requests straight from the browser (accept) or
-- through complete_delivery_with_proof (SECURITY INVOKER, so its UPDATE
-- passes through here too). None of the existing RLS policies look at
-- is_active, so a rider blocked while a dashboard tab is still open could
-- keep working. This trigger refuses that.
--
-- - Only the rider side is affected: updates by admins, and by the cook
--   (auth.uid() = kitchen_id, not the rider), go through untouched.
-- - Rows that are already completed (delivered) or cancelled are left
--   exactly as before — this guard never fires for them.
-- - SECURITY DEFINER helper for the same reason as user_has_role(): it reads
--   profiles without re-entering profiles' own RLS.
-- ---------------------------------------------------------------------------
create or replace function public.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_active from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function public.guard_blocked_rider_delivery_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null or public.user_has_role('admin') then
    return new;
  end if;

  if old.status in ('completed', 'cancelled') then
    return new;
  end if;

  if (auth.uid() = new.rider_id or auth.uid() = old.rider_id)
     and public.user_has_role('rider')
     and not public.current_user_is_active() then
    raise exception 'Your account is blocked.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_blocked_rider_delivery_update on public.delivery_requests;
create trigger guard_blocked_rider_delivery_update
  before update on public.delivery_requests
  for each row execute function public.guard_blocked_rider_delivery_update();

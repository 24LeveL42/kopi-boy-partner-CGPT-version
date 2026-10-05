-- ============================================================================
-- KOPI BOY 2.0 — Customer <-> Rider chat for an active delivery
-- Run this ONCE, after every script in supabase-schema.sql and
-- supabase-notifications.sql, in the same Supabase project's SQL Editor
-- (Dashboard > SQL Editor > New query > paste this whole file > Run).
--
-- Safe to re-run: every statement is idempotent (CREATE TABLE IF NOT EXISTS,
-- DROP POLICY IF EXISTS before CREATE, CREATE OR REPLACE for functions).
--
-- This is the ONE definition of these objects — same rule as get_order_rider
-- in supabase-schema.sql. If the Customer app has its own copy of the schema
-- files, don't duplicate this section there; both apps talk to the same
-- Supabase project, so running it once here is enough.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. MESSAGES
-- One row per chat message on an order. Deliberately minimal: no edit, no
-- delete, no read receipts — same "immutable snapshot" shape as order_items.
-- ----------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(btrim(body)) > 0 and length(body) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists messages_order_created_idx
  on public.messages (order_id, created_at);

alter table public.messages enable row level security;

-- select + insert only — no update, no delete (chat history is immutable and
-- is never wiped by the app; see order_chat_participant() below for when it
-- stops being *visible*).
grant select, insert on public.messages to authenticated;

-- ----------------------------------------------------------------------------
-- 2. order_chat_participant(): is the caller allowed into this order's chat?
-- SECURITY DEFINER is required here, not just style: a customer has no SELECT
-- access to delivery_requests (only cooks/riders/admin do — see
-- supabase-schema.sql section 18), so a plain invoker-rights check would
-- always read 0 rows for a customer and silently deny everyone. Same
-- workaround already used for public.get_order_rider().
--
-- Returns true only while ALL of these hold — this is both the "who" and the
-- "until when" rule in one place, so select and insert can't drift apart:
--   * the order is not cancelled/rejected;
--   * the order has a delivery_requests row with status = 'accepted' (once a
--     rider marks it completed, or backs out, or it's cancelled, that row no
--     longer matches, and access stops for both sides — no separate "is it
--     terminal" check needed);
--   * the caller is that order's customer OR that delivery's rider.
-- No admin bypass on purpose — this scope is customer + assigned rider only.
-- ----------------------------------------------------------------------------
create or replace function public.order_chat_participant(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.orders o
    join public.delivery_requests d on d.order_id = o.id
    where o.id = p_order_id
      and o.order_status not in ('cancelled', 'rejected')
      and d.status = 'accepted'
      and (o.customer_id = auth.uid() or d.rider_id = auth.uid())
  );
$$;

revoke all on function public.order_chat_participant(uuid) from public, anon;
grant execute on function public.order_chat_participant(uuid) to authenticated;

drop policy if exists "Participants can read active order chat" on public.messages;
create policy "Participants can read active order chat"
  on public.messages for select
  using (public.order_chat_participant(order_id));

drop policy if exists "Participants can send active order chat messages" on public.messages;
create policy "Participants can send active order chat messages"
  on public.messages for insert
  with check (sender_id = auth.uid() and public.order_chat_participant(order_id));

-- ----------------------------------------------------------------------------
-- 3. REALTIME
-- Same mechanism as the notifications inbox: RLS still applies to what each
-- subscriber receives, so a stale session watching an order that just went
-- terminal simply stops getting rows — it doesn't need to unsubscribe.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4. PHOTO ATTACHMENTS
-- Same shape as the Customer app's complaint_messages + complaint-photos
-- (its supabase-schema.sql sections 25-26): a message may carry a photo, and
-- photo_path is an object KEY in a PRIVATE bucket, not a URL — the app turns
-- it into a short-lived signed URL when rendering. Body may be empty only
-- alongside a photo. The path check pins the key under this message's own
-- order folder, so a message can't point at another order's photo.
--
-- The existing table-level `grant select, insert on public.messages` already
-- covers the new column; nothing to add there.
-- ----------------------------------------------------------------------------
alter table public.messages add column if not exists photo_path text;
alter table public.messages alter column body set default '';

-- Replaces the inline check from section 1 (Postgres auto-named it
-- messages_body_check). Existing rows all have a non-empty body, so they pass.
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_check
  check (length(body) <= 2000 and (length(btrim(body)) > 0 or photo_path is not null));

alter table public.messages drop constraint if exists messages_photo_path_check;
alter table public.messages add constraint messages_photo_path_check
  check (photo_path is null or photo_path like order_id::text || '/%');

-- ----------------------------------------------------------------------------
-- 5. ORDER CHAT PHOTOS BUCKET (private)
-- Object key: <order_id>/<uploader_id>/<random>.<ext>. Read and upload are
-- allowed to exactly the people order_chat_participant() lets into the chat
-- (first folder), and uploads must sit in the uploader's own sub-folder. So
-- photos follow the chat's own window: once the delivery is completed or the
-- order is cancelled/rejected, neither side can fetch or sign them any more
-- (the objects are kept, like the message rows). No update/delete policy:
-- chat history is immutable. The regex guard keeps a non-uuid folder name
-- from raising a cast error inside the policy — such a key is just denied.
--
-- No storage GRANTs needed: Supabase already grants authenticated
-- select/insert on storage.objects; these policies are what scope it.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-chat-photos', 'order-chat-photos', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Order chat participants can view its photos" on storage.objects;
create policy "Order chat participants can view its photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'order-chat-photos'
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.order_chat_participant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

drop policy if exists "Order chat participants can upload photos" on storage.objects;
create policy "Order chat participants can upload photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'order-chat-photos'
    and (storage.foldername(name))[2] = auth.uid()::text
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.order_chat_participant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

-- ----------------------------------------------------------------------------
-- 6. PROOF OF DELIVERY
-- A rider can only mark their delivery completed together with a photo: the
-- app uploads the photo to order-chat-photos first (while the chat is still
-- open, so the section 5 policies allow it), then calls
-- complete_delivery_with_proof(), which posts the photo as a normal chat
-- message AND flips the delivery to completed in ONE transaction — if either
-- step fails, neither happens.
--
-- SECURITY INVOKER on purpose: every step runs under the rider's own RLS
-- (messages insert policy, the rider update policy on delivery_requests, the
-- storage select policy), so this grants nothing the rider couldn't already
-- do — it only bundles it. The message is inserted BEFORE the status update
-- because order_chat_participant() stops matching once the delivery is
-- completed.
--
-- The trigger closes the side door: the existing "Riders can complete their
-- assigned delivery request" policy would still let a rider PATCH status to
-- 'completed' directly. When the updater is the delivery's own rider, the
-- trigger requires the transaction-local flag that only this function sets
-- (set_config isn't reachable through PostgREST — it lives in pg_catalog, not
-- an exposed schema). Admin/cook updates are unaffected.
--
-- The proof message is flagged is_delivery_proof, and that flag is what the
-- one exception to "chat closes on completion" hangs off (section 7). A BEFORE
-- INSERT trigger lets the flag be set only inside this function (same
-- transaction-local setting), so an ordinary chat message can't claim it.
-- ----------------------------------------------------------------------------
alter table public.messages add column if not exists is_delivery_proof boolean not null default false;

create or replace function public.guard_delivery_proof_message()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_delivery_proof and not exists (
    select 1 from public.delivery_requests d
    where d.order_id = new.order_id
      and d.id::text = coalesce(current_setting('kopiboy.delivery_proof', true), '')
  ) then
    raise exception 'Only a delivery completion can post a proof-of-delivery message.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_delivery_proof_message on public.messages;
create trigger guard_delivery_proof_message
  before insert on public.messages
  for each row execute function public.guard_delivery_proof_message();

create or replace function public.complete_delivery_with_proof(p_request_id uuid, p_photo_path text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  if p_photo_path is null or btrim(p_photo_path) = '' then
    raise exception 'A proof-of-delivery photo is required.' using errcode = '22023';
  end if;

  select d.order_id into v_order_id
  from public.delivery_requests d
  where d.id = p_request_id
    and d.rider_id = auth.uid()
    and d.status = 'accepted'
  for update;

  if v_order_id is null then
    raise exception 'This delivery is no longer active.' using errcode = 'P0002';
  end if;

  -- The photo must really have been uploaded by this rider for this order.
  if not exists (
    select 1 from storage.objects so
    where so.bucket_id = 'order-chat-photos'
      and so.name = p_photo_path
      and (storage.foldername(so.name))[1] = v_order_id::text
      and (storage.foldername(so.name))[2] = auth.uid()::text
  ) then
    raise exception 'The proof-of-delivery photo was not found — please upload it again.' using errcode = '22023';
  end if;

  perform set_config('kopiboy.delivery_proof', p_request_id::text, true);

  insert into public.messages (order_id, sender_id, body, photo_path, is_delivery_proof)
  values (v_order_id, auth.uid(), 'Delivered — proof of delivery photo.', p_photo_path, true);

  update public.delivery_requests
  set status = 'completed', completed_at = now()
  where id = p_request_id;
end;
$$;

revoke all on function public.complete_delivery_with_proof(uuid, text) from public, anon;
grant execute on function public.complete_delivery_with_proof(uuid, text) to authenticated;

create or replace function public.require_delivery_proof()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'completed'
     and old.status is distinct from 'completed'
     and new.rider_id = auth.uid()
     and coalesce(current_setting('kopiboy.delivery_proof', true), '') <> new.id::text
  then
    raise exception 'Mark a delivery completed with a proof-of-delivery photo.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists require_delivery_proof on public.delivery_requests;
create trigger require_delivery_proof
  before update of status on public.delivery_requests
  for each row execute function public.require_delivery_proof();

-- ----------------------------------------------------------------------------
-- 7. PROOF OF DELIVERY STAYS VISIBLE TO THE CUSTOMER
-- The one narrow exception to "chat closes on completion": the order's
-- customer can keep reading the is_delivery_proof message(s) and signing
-- their photo after the delivery is completed. Nothing else in the thread
-- reopens, and nothing here allows sending. These are extra PERMISSIVE
-- policies, so they OR with the section 2 / section 5 ones instead of
-- replacing them. customers can already read their own orders row, so the
-- ownership check needs no SECURITY DEFINER helper.
-- ----------------------------------------------------------------------------
drop policy if exists "Customers can read their order's proof of delivery" on public.messages;
create policy "Customers can read their order's proof of delivery"
  on public.messages for select
  using (
    is_delivery_proof
    and exists (
      select 1 from public.orders o
      where o.id = messages.order_id and o.customer_id = auth.uid()
    )
  );

-- Goes through the messages RLS above, so it matches exactly the proof photos
-- the caller may read.
drop policy if exists "Customers can view their order's proof-of-delivery photo" on storage.objects;
create policy "Customers can view their order's proof-of-delivery photo"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'order-chat-photos'
    and exists (
      select 1 from public.messages m
      where m.photo_path = objects.name and m.is_delivery_proof
    )
  );

-- ----------------------------------------------------------------------------
-- HOW TO CHECK IT'S WORKING (run after applying the file above)
--
-- As the DB owner (SQL Editor bypasses RLS, so this only proves the rows
-- exist — it does NOT prove RLS is enforced; use two real sessions for that):
--   select * from public.messages order by created_at desc limit 20;
--
-- To prove RLS itself: open two browser sessions (or two Supabase client
-- instances) signed in as the order's customer and the accepted rider, plus
-- a third signed in as an unrelated user. Insert/select from the app (or via
-- supabase.from('messages')...) as each and confirm:
--   * customer + assigned rider can read/send;
--   * the unrelated user's select returns zero rows and insert is rejected
--     ("new row violates row-level security policy");
--   * once the rider marks the delivery completed (or it's cancelled), both
--     the customer's and the rider's selects go back to zero rows for that
--     order_id, even though the rows are still in the table.
--   * photos: the unrelated user's upload to order-chat-photos/<order_id>/...
--     is rejected, and createSignedUrl on an existing photo key fails for
--     them (and for both participants once the delivery is completed).
--   * proof of delivery: as the rider, a direct
--     update delivery_requests set status = 'completed' is rejected ("Mark a
--     delivery completed with a proof-of-delivery photo."); rpc
--     complete_delivery_with_proof with a missing/unknown photo path is
--     rejected and the delivery stays 'accepted' with no new message; with a
--     real uploaded path, one photo message appears AND the status is
--     'completed'.
--   * after completion, the customer's select on messages for that order
--     returns ONLY the proof message, and createSignedUrl on its photo works;
--     a normal chat photo of the same order still fails. Inserting a message
--     with is_delivery_proof = true directly is rejected.
-- ----------------------------------------------------------------------------

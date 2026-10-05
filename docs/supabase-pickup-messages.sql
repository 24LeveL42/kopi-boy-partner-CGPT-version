-- ============================================================================
-- KOPI BOY 2.0 — Picker <-> Rider chat for an accepted pickup
-- Run this ONCE, after every script in supabase-schema.sql and
-- supabase-messages.sql, in the same Supabase project's SQL Editor
-- (Dashboard > SQL Editor > New query > paste this whole file > Run).
--
-- Safe to re-run: every statement is idempotent.
--
-- Mirrors the customer <-> rider order chat (supabase-messages.sql sections
-- 1-5) one-for-one, keyed on a pickup_requests row instead of an order. It's
-- a separate table rather than a pickup_request_id column on `messages`:
-- messages is built around a NOT NULL order_id (FK, photo-path check,
-- order_chat_participant(), the proof-of-delivery rules) and pickup requests
-- aren't tied to an order at all, so sharing the table would mean a nullable
-- key plus an either/or branch in every check and policy.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PICKUP_MESSAGES
-- Same shape and rules as public.messages after its section 4: immutable
-- (select + insert only), body may be empty only alongside a photo, and the
-- photo key must sit under this message's own pickup request folder.
-- ----------------------------------------------------------------------------
create table if not exists public.pickup_messages (
  id uuid primary key default gen_random_uuid(),
  pickup_request_id uuid not null references public.pickup_requests(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '',
  photo_path text,
  created_at timestamptz not null default now(),
  constraint pickup_messages_body_check
    check (length(body) <= 2000 and (length(btrim(body)) > 0 or photo_path is not null)),
  constraint pickup_messages_photo_path_check
    check (photo_path is null or photo_path like pickup_request_id::text || '/%')
);

create index if not exists pickup_messages_request_created_idx
  on public.pickup_messages (pickup_request_id, created_at);

alter table public.pickup_messages enable row level security;

-- select + insert only — no update, no delete (same as messages).
grant select, insert on public.pickup_messages to authenticated;

-- ----------------------------------------------------------------------------
-- 2. pickup_chat_participant(): is the caller allowed into this pickup's chat?
-- Same "who" + "until when" rule as order_chat_participant(), in one place so
-- select, insert and the photo policies can't drift apart. True only while
-- the pickup request is 'accepted' AND the caller is that request's rider
-- (who asked for the picker) or its picker. Once it's completed or cancelled
-- the row no longer matches and access stops for both sides. No admin bypass,
-- same as the order chat.
--
-- SECURITY DEFINER for parity with order_chat_participant(), and so the check
-- doesn't depend on the separately maintained pickup_requests read policies.
-- It reads one row and returns only a boolean. Execute is revoked from
-- anon/authenticated too (Supabase grants those directly on new functions,
-- same note as get_order_rider) and granted back to authenticated only.
-- ----------------------------------------------------------------------------
create or replace function public.pickup_chat_participant(p_pickup_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pickup_requests pr
    where pr.id = p_pickup_request_id
      and pr.status = 'accepted'
      and (pr.rider_id = auth.uid() or pr.picker_id = auth.uid())
  );
$$;

revoke all on function public.pickup_chat_participant(uuid) from public, anon, authenticated;
grant execute on function public.pickup_chat_participant(uuid) to authenticated;

drop policy if exists "Participants can read active pickup chat" on public.pickup_messages;
create policy "Participants can read active pickup chat"
  on public.pickup_messages for select
  using (public.pickup_chat_participant(pickup_request_id));

drop policy if exists "Participants can send active pickup chat messages" on public.pickup_messages;
create policy "Participants can send active pickup chat messages"
  on public.pickup_messages for insert
  with check (sender_id = auth.uid() and public.pickup_chat_participant(pickup_request_id));

-- ----------------------------------------------------------------------------
-- 3. REALTIME
-- Same as messages: RLS still applies to what each subscriber receives.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pickup_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.pickup_messages';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4. PICKUP CHAT PHOTOS BUCKET (private)
-- Same as order-chat-photos (supabase-messages.sql section 5): object key
-- <pickup_request_id>/<uploader_id>/<random>.<ext>; read and upload only for
-- pickup_chat_participant() on the first folder; uploads only into your own
-- sub-folder; no update/delete policy; same size/mime limits. The regex guard
-- keeps a non-uuid folder name from raising a cast error inside the policy.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pickup-chat-photos', 'pickup-chat-photos', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Pickup chat participants can view its photos" on storage.objects;
create policy "Pickup chat participants can view its photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'pickup-chat-photos'
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.pickup_chat_participant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

drop policy if exists "Pickup chat participants can upload photos" on storage.objects;
create policy "Pickup chat participants can upload photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'pickup-chat-photos'
    and (storage.foldername(name))[2] = auth.uid()::text
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.pickup_chat_participant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

-- ----------------------------------------------------------------------------
-- HOW TO CHECK IT'S WORKING
-- Sign in as the pickup's rider, its picker, and an unrelated picker + rider:
--   * rider + picker can read/send on an accepted pickup; photos upload and
--     sign for both;
--   * the unrelated users' select returns zero rows, their insert is rejected,
--     and their upload to pickup-chat-photos/<pickup_request_id>/... fails;
--   * once the picker marks the handoff complete (or it's cancelled), both
--     sides' selects return zero rows and photo signing fails, though the rows
--     and objects are kept.
-- ----------------------------------------------------------------------------

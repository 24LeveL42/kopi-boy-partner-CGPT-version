-- KOPI BOY — Partner <-> Rider delivery chat + rider details RPC
-- Run once in the SAME Supabase project used by customer/partner apps.
-- Safe to re-run. Does not change orders or delivery state transitions.

-- ---------------------------------------------------------------------------
-- 1. Rider details visible to the cook who owns the delivery request.
-- Profiles are intentionally private, so this SECURITY DEFINER function exposes
-- only the minimum fields needed by the cook's active delivery card.
-- ---------------------------------------------------------------------------
create or replace function public.get_delivery_rider(p_delivery_request_id uuid)
returns table (
  full_name text,
  phone text,
  photo_url text,
  vehicle_type text,
  license_plate text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.full_name,
    p.phone,
    p.photo_url,
    ra.vehicle_type,
    ra.license_plate
  from public.delivery_requests d
  join public.profiles p on p.id = d.rider_id
  left join lateral (
    select vehicle_type, license_plate
    from public.rider_applications
    where user_id = d.rider_id
      and status = 'approved'
    order by created_at desc
    limit 1
  ) ra on true
  where d.id = p_delivery_request_id
    and d.rider_id is not null
    and (d.kitchen_id = auth.uid() or d.rider_id = auth.uid())
  limit 1;
$$;

revoke all on function public.get_delivery_rider(uuid) from public, anon;
grant execute on function public.get_delivery_rider(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Partner <-> rider chat, kept separate from customer <-> rider messages.
-- This means customer chat remains private and partner/rider coordination is
-- visible only to the cook owning the order and the assigned rider.
-- ---------------------------------------------------------------------------
create table if not exists public.partner_rider_messages (
  id uuid primary key default gen_random_uuid(),
  delivery_request_id uuid not null references public.delivery_requests(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '',
  photo_path text,
  created_at timestamptz not null default now(),
  constraint partner_rider_messages_body_check
    check (length(body) <= 2000 and (length(btrim(body)) > 0 or photo_path is not null)),
  constraint partner_rider_messages_photo_path_check
    check (photo_path is null or photo_path like delivery_request_id::text || '/%')
);

create index if not exists partner_rider_messages_request_created_idx
  on public.partner_rider_messages (delivery_request_id, created_at);

alter table public.partner_rider_messages enable row level security;
grant select, insert on public.partner_rider_messages to authenticated;

create or replace function public.partner_rider_chat_participant(p_delivery_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.delivery_requests d
    where d.id = p_delivery_request_id
      and d.status = 'accepted'
      and (d.kitchen_id = auth.uid() or d.rider_id = auth.uid())
  );
$$;

revoke all on function public.partner_rider_chat_participant(uuid) from public, anon;
grant execute on function public.partner_rider_chat_participant(uuid) to authenticated;

drop policy if exists "Partner/rider can read active delivery chat" on public.partner_rider_messages;
create policy "Partner/rider can read active delivery chat"
  on public.partner_rider_messages for select
  using (public.partner_rider_chat_participant(delivery_request_id));

drop policy if exists "Partner/rider can send active delivery chat" on public.partner_rider_messages;
create policy "Partner/rider can send active delivery chat"
  on public.partner_rider_messages for insert
  with check (sender_id = auth.uid() and public.partner_rider_chat_participant(delivery_request_id));

-- Realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'partner_rider_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.partner_rider_messages';
  end if;
end $$;

-- Private photo bucket for this chat.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('partner-rider-chat-photos', 'partner-rider-chat-photos', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Partner/rider chat participants can view photos" on storage.objects;
create policy "Partner/rider chat participants can view photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'partner-rider-chat-photos'
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.partner_rider_chat_participant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

drop policy if exists "Partner/rider chat participants can upload photos" on storage.objects;
create policy "Partner/rider chat participants can upload photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'partner-rider-chat-photos'
    and (storage.foldername(name))[2] = auth.uid()::text
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.partner_rider_chat_participant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

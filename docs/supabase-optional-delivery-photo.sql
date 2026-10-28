-- ============================================================================
-- KOPI BOY 2.0 — Delivery photo is OPTIONAL
-- DRAFT — NOT RUN YET. Run this in the Supabase SQL Editor AFTER
-- docs/supabase-messages.sql (which it amends) and, if used,
-- docs/supabase-delivery-pickup.sql. Safe to re-run.
--
-- Run it BEFORE deploying the app change: the current app always sends a
-- photo, so it keeps working with this function; the new app sends null
-- when the rider skips the photo, which the old function would refuse.
--
-- What changes:
--   1. complete_delivery_with_proof(p_request_id, p_photo_path): the photo
--      may now be null/empty. With a photo, behaviour is exactly as before
--      (photo must be this rider's upload for this order, posted to the
--      customer as the is_delivery_proof message, then completed — one
--      transaction). Without one, no message is posted and the delivery is
--      simply completed.
--   2. require_delivery_proof(): same check (a rider must still complete
--      through the function above, not a direct PATCH), new wording that no
--      longer mentions a photo.
--
-- Unchanged: the signature (so existing GRANTs stay), the "accepted and
-- yours" check, the pickup guard (collect first), the blocked-rider guard,
-- the notifications on status = 'completed', and every RLS / storage policy.
-- ============================================================================

create or replace function public.complete_delivery_with_proof(p_request_id uuid, p_photo_path text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order_id uuid;
  v_photo_path text := nullif(btrim(coalesce(p_photo_path, '')), '');
begin
  select d.order_id into v_order_id
  from public.delivery_requests d
  where d.id = p_request_id
    and d.rider_id = auth.uid()
    and d.status = 'accepted'
  for update;

  if v_order_id is null then
    raise exception 'This delivery is no longer active.' using errcode = 'P0002';
  end if;

  -- A photo is optional, but if one is sent it must really have been
  -- uploaded by this rider for this order.
  if v_photo_path is not null and not exists (
    select 1 from storage.objects so
    where so.bucket_id = 'order-chat-photos'
      and so.name = v_photo_path
      and (storage.foldername(so.name))[1] = v_order_id::text
      and (storage.foldername(so.name))[2] = auth.uid()::text
  ) then
    raise exception 'The delivery photo was not found — please upload it again, or remove it.' using errcode = '22023';
  end if;

  perform set_config('kopiboy.delivery_proof', p_request_id::text, true);

  -- Before the status update: order_chat_participant() stops matching once
  -- the delivery is completed.
  if v_photo_path is not null then
    insert into public.messages (order_id, sender_id, body, photo_path, is_delivery_proof)
    values (v_order_id, auth.uid(), 'Delivered — proof of delivery photo.', v_photo_path, true);
  end if;

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
    raise exception 'Use "Mark delivered" in the app to complete a delivery.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- HOW TO CHECK IT'S WORKING (signed in as the assigned rider, food collected)
--   * rpc complete_delivery_with_proof(id, null) and (id, '') -> delivery is
--     'completed', NO new message row for the order.
--   * rpc with a real uploaded key -> one is_delivery_proof message AND
--     'completed' (as before).
--   * rpc with a made-up key -> refused, delivery stays 'accepted', no message.
--   * a direct PATCH status = 'completed' as the rider is still refused.
--   * before "I've collected the food", the rpc is still refused
--     ("Collect the food first, then mark it delivered.").
-- ----------------------------------------------------------------------------

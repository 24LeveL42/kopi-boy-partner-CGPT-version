# Kopi Boy Partner — Ferrari Rider Coordination Update

## What changed

- Partner/cook order cards now show the assigned rider after acceptance:
  - rider photo
  - rider name
  - phone number
  - vehicle type
  - license plate
  - live "On the way" status
  - Call Rider button
  - Chat with Rider button
- Rider dashboard now has a dedicated **Chat with Partner** panel for the active delivery.
- Partner/rider chat is kept in its own `partner_rider_messages` table so it does not mix with the existing Customer <-> Rider order chat.
- Chat supports realtime text and the same photo attachment workflow used by the existing chats.
- Added a secure `get_delivery_rider()` RPC. Partner users do not receive unrestricted access to rider profiles; the RPC exposes only the rider details needed for the delivery card.

## Supabase migration

Run `docs/supabase-partner-rider-chat.sql` once in the same Supabase project used by Kopi Boy.

The migration creates:

- `get_delivery_rider(uuid)`
- `partner_rider_messages`
- `partner_rider_chat_participant(uuid)`
- realtime publication for `partner_rider_messages`
- private `partner-rider-chat-photos` storage bucket + RLS policies

No order status, payment, delivery acceptance, proof-of-delivery, customer chat, or admin workflow is replaced.

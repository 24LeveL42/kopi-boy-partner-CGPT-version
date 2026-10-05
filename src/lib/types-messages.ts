/**
 * Order chat message — mirrors the `messages` table in
 * `docs/supabase-messages.sql`. Visible only to the order's customer and the
 * currently accepted rider, and only while the delivery is accepted (RLS
 * enforces both — see order_chat_participant() in that file).
 */
export interface OrderMessage {
  id: string;
  order_id: string;
  sender_id: string;
  /** May be empty only when photo_path is set (messages_body_check). */
  body: string;
  /** Key in the private `order-chat-photos` bucket, not a URL — OrderChat signs it to render. */
  photo_path: string | null;
  /** Posted by complete_delivery_with_proof; stays readable by the customer after completion. */
  is_delivery_proof: boolean;
  created_at: string;
}

/**
 * Pickup chat message — mirrors `pickup_messages` in
 * `docs/supabase-pickup-messages.sql`. Visible only to the pickup's rider and
 * picker, and only while the pickup request is accepted.
 */
export interface PickupMessage {
  id: string;
  pickup_request_id: string;
  sender_id: string;
  body: string;
  photo_path: string | null;
  created_at: string;
}

/** The fields ThreadChat renders — common to both chat tables. */
export type ChatMessage = Pick<OrderMessage, "id" | "sender_id" | "body" | "photo_path" | "created_at">;


/** Partner/cook <-> rider chat message for one active delivery request. */
export interface PartnerRiderMessage {
  id: string;
  delivery_request_id: string;
  sender_id: string;
  body: string;
  photo_path: string | null;
  created_at: string;
}

import { ThreadChat, type ThreadChatConfig } from "@/components/ThreadChat";
import { PICKUP_CHAT_PHOTO_BUCKET } from "@/lib/order-chat-photo";

// docs/supabase-pickup-messages.sql — visible to the pickup's rider and
// picker while the pickup request is accepted.
const BASE = {
  table: "pickup_messages",
  threadColumn: "pickup_request_id",
  bucket: PICKUP_CHAT_PHOTO_BUCKET,
  emptyText: "No messages yet — say hi to arrange the handoff.",
} as const;

const AS_PICKER: ThreadChatConfig = {
  ...BASE,
  title: "Chat with rider",
  otherLabel: "Rider",
  placeholder: "Message the rider…",
};

const AS_RIDER: ThreadChatConfig = {
  ...BASE,
  title: "Chat with picker",
  otherLabel: "Picker",
  placeholder: "Message the picker…",
};

/** Picker <-> rider chat for one accepted pickup request; `as` is the viewer's side. */
export function PickupChat({
  pickupRequestId,
  userId,
  as,
}: {
  pickupRequestId: string;
  userId: string;
  as: "picker" | "rider";
}) {
  return <ThreadChat config={as === "picker" ? AS_PICKER : AS_RIDER} threadId={pickupRequestId} userId={userId} />;
}

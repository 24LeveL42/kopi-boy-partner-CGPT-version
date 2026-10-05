import { ThreadChat, type ThreadChatConfig } from "@/components/ThreadChat";
import { ORDER_CHAT_PHOTO_BUCKET } from "@/lib/order-chat-photo";

// docs/supabase-messages.sql — visible to the order's customer and the
// accepted rider while the delivery is accepted.
const ORDER_CHAT: ThreadChatConfig = {
  table: "messages",
  threadColumn: "order_id",
  bucket: ORDER_CHAT_PHOTO_BUCKET,
  title: "Chat with customer",
  otherLabel: "Customer",
  emptyText: "No messages yet — say hi when you're on the way.",
  placeholder: "Message the customer…",
};

/** The rider's side of an order's customer <-> rider chat. */
export function OrderChat({ orderId, userId }: { orderId: string; userId: string }) {
  return <ThreadChat config={ORDER_CHAT} threadId={orderId} userId={userId} />;
}

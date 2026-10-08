import { ThreadChat, type ThreadChatConfig } from "@/components/ThreadChat";
import { PARTNER_RIDER_CHAT_PHOTO_BUCKET } from "@/lib/order-chat-photo";

const PARTNER_CHAT: ThreadChatConfig = {
  table: "partner_rider_messages",
  threadColumn: "delivery_request_id",
  bucket: PARTNER_RIDER_CHAT_PHOTO_BUCKET,
  title: "Chat with rider",
  otherLabel: "Rider",
  emptyText: "No messages yet — coordinate the pickup with your rider.",
  placeholder: "Message the rider…",
  allowPhotos: false,
};

export function PartnerRiderChat({ deliveryRequestId, userId }: { deliveryRequestId: string; userId: string }) {
  return <ThreadChat config={PARTNER_CHAT} threadId={deliveryRequestId} userId={userId} />;
}

import type { SupabaseClient } from "@supabase/supabase-js";

// Must stay in sync with the order-chat-photos bucket and the messages checks
// in docs/supabase-messages.sql (sections 4-5), which enforce the same rules
// server-side. Same layout as the Customer app's complaint-photos helpers.
// pickup-chat-photos (docs/supabase-pickup-messages.sql section 4) uses the
// exact same limits and key layout, so both chats share these helpers.
export const ORDER_CHAT_PHOTO_BUCKET = "order-chat-photos";
export const PICKUP_CHAT_PHOTO_BUCKET = "pickup-chat-photos";
export const PARTNER_RIDER_CHAT_PHOTO_BUCKET = "partner-rider-chat-photos";
export const ORDER_CHAT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const ORDER_CHAT_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

/** How long a rendered photo link stays valid. */
export const ORDER_CHAT_PHOTO_URL_TTL_SECONDS = 60 * 60;

export const MESSAGE_BODY_MAX_LENGTH = 2000;

/** Returns why a picked file can't be attached, or null if it's fine. */
export function validateOrderChatPhoto(file: { type: string; size: number }): string | null {
  if (!ORDER_CHAT_PHOTO_TYPES.includes(file.type)) return "Please choose a JPEG, PNG, WebP or HEIC photo.";
  if (file.size > ORDER_CHAT_PHOTO_MAX_BYTES) return "That photo is over 5 MB — please choose a smaller one.";
  return null;
}

/**
 * Object key `<thread_id>/<uploader_id>/<random>.<ext>` (thread = order or
 * pickup request) — the storage policies require exactly this layout, and the
 * tables' photo_path checks require the key to sit under the row's own thread.
 */
export function orderChatPhotoPath(threadId: string, userId: string, fileName: string, id: string): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(fileName)?.[1]?.toLowerCase() ?? "jpg";
  return `${threadId}/${userId}/${id}.${ext}`;
}

/**
 * Uploads a picked (already validated) photo under this thread/user's folder
 * of `bucket` and returns its object key, or null if the upload failed. Every
 * call gets a fresh key, so nothing is ever overwritten.
 */
export async function uploadChatPhoto(
  supabase: SupabaseClient,
  bucket: string,
  threadId: string,
  userId: string,
  file: File
): Promise<string | null> {
  const path = orderChatPhotoPath(threadId, userId, file.name, crypto.randomUUID());
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
  return error ? null : path;
}

export function uploadOrderChatPhoto(supabase: SupabaseClient, orderId: string, userId: string, file: File) {
  return uploadChatPhoto(supabase, ORDER_CHAT_PHOTO_BUCKET, orderId, userId, file);
}

/** Trimmed body, or null when there's nothing sendable (text or a photo is required). */
export function normalizeOrderChatBody(raw: string, hasPhoto: boolean): string | null {
  const body = raw.trim();
  if (body.length > MESSAGE_BODY_MAX_LENGTH) return null;
  if (!body && !hasPhoto) return null;
  return body;
}

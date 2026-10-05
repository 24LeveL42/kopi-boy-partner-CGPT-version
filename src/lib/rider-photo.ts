import type { SupabaseClient } from "@supabase/supabase-js";

// Must stay in sync with the rider-photos bucket in docs/supabase-schema.sql
// (section 23), which enforces the same size and mime-type limits server-side.
export const RIDER_PHOTO_BUCKET = "rider-photos";
export const RIDER_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const RIDER_PHOTO_ACCEPT = Object.keys(EXT_BY_TYPE).join(",");

/** The chosen file was rejected before upload — its message is safe to show as-is. */
export class PhotoValidationError extends Error {}

/**
 * Uploads a rider-chosen file to the public rider-photos bucket under this
 * user's own folder (required by the bucket's RLS policies) and returns its
 * public URL. Every upload gets a fresh path, so a replaced photo never serves
 * a stale cached copy from the old URL.
 */
export async function uploadRiderPhoto(supabase: SupabaseClient, userId: string, file: File): Promise<string> {
  const ext = EXT_BY_TYPE[file.type];
  if (!ext) throw new PhotoValidationError("Please choose a JPG, PNG or WebP photo.");
  if (file.size > RIDER_PHOTO_MAX_BYTES) {
    throw new PhotoValidationError("That photo is too large — please choose one under 10 MB.");
  }

  const path = `${userId}/photo-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(RIDER_PHOTO_BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw error;
  return supabase.storage.from(RIDER_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PhotoValidationError, RIDER_PHOTO_ACCEPT, uploadRiderPhoto } from "@/lib/rider-photo";
import { Avatar } from "./Avatar";
import { Spinner } from "./Pending";

// Supabase Storage errors don't always put the reason in `.message`, so log the
// raw object and surface whatever readable text is there (same approach as
// KitchenSetupForm's describeSupabaseError).
function describeUploadError(err: unknown): string {
  console.error("PhotoPicker upload error:", err);
  if (err && typeof err === "object") {
    const e = err as { message?: string; error?: string; statusCode?: string | number };
    const text = [e.message, e.error].find((p) => !!p && p.trim().length > 0);
    if (text) return `Couldn't upload the photo — ${text}${e.statusCode ? ` (${e.statusCode})` : ""}`;
  }
  return "Couldn't upload the photo — check the browser console for the full error.";
}

/**
 * File picker for a rider's or picker's own photo: uploads as soon as a file is chosen
 * (same as the kitchen/dish photo pickers), shows a preview, and reports the
 * resulting public URL through `onChange`. Nothing is written to the database
 * here — the parent form saves the URL along with its other fields.
 */
export function PhotoPicker({
  userId,
  name,
  value,
  onChange,
  onUploadingChange,
  tone,
}: {
  userId: string;
  name: string | null;
  value: string | null;
  onChange: (url: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
  /** "dark" on the navy application form, "light" inside white cards. */
  tone: "dark" | "light";
}) {
  const supabase = createClient();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    onUploadingChange?.(true);
    try {
      onChange(await uploadRiderPhoto(supabase, userId, file));
    } catch (err) {
      setError(err instanceof PhotoValidationError ? err.message : describeUploadError(err));
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
    }
  }

  const soft = tone === "dark" ? "var(--kb-on-navy-soft)" : "var(--kb-ink-soft)";

  return (
    <div>
      <div className="flex items-center gap-3">
        <Avatar url={value} name={name} size={56} />
        <input
          type="file"
          accept={RIDER_PHOTO_ACCEPT}
          onChange={handleFileChange}
          disabled={uploading}
          aria-label="Choose a photo"
          className="w-full text-sm"
          style={{ color: soft }}
        />
      </div>
      {uploading && (
        <p className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: soft }}>
          <Spinner size={12} />
          Uploading…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs" style={{ color: tone === "dark" ? "#FCA5A5" : "#B91C1C" }}>
          {error}
        </p>
      )}
    </div>
  );
}

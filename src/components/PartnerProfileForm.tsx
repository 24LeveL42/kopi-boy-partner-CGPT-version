"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePendingAction } from "@/lib/use-pending-action";
import { PendingLabel } from "./Pending";
import { PhotoPicker } from "./PhotoPicker";

/**
 * Live, self-editable rider/picker profile — the photo and contact number an
 * approved rider or picker can change any time, separate from the one-time
 * application. Both live on their own `profiles` row (photo_url, phone).
 */
export function PartnerProfileForm({
  role,
  userId,
  fullName,
  phone,
  photoUrl,
}: {
  role: "rider" | "picker";
  userId: string;
  fullName: string | null;
  phone: string | null;
  photoUrl: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [contactNumber, setContactNumber] = useState(phone ?? "");
  const [photo, setPhoto] = useState<string | null>(photoUrl);
  // What's currently saved, so "Save" is only enabled when something changed.
  const [saved, setSaved] = useState({ phone: phone ?? "", photo: photoUrl });
  const [photoUploading, setPhotoUploading] = useState(false);
  const { busy: saving, run } = usePendingAction();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = contactNumber.trim() !== saved.phone || photo !== saved.photo;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setJustSaved(false);

    const nextPhone = contactNumber.trim();
    if (!nextPhone) {
      setError("Please enter a contact number.");
      return;
    }

    run("save", async () => {
      // .select() so a write that RLS silently filters to zero rows is reported
      // as a failure instead of looking like a successful save.
      const { data, error: updateError } = await supabase
        .from("profiles")
        .update({ phone: nextPhone, photo_url: photo })
        .eq("id", userId)
        .select("id");

      if (updateError) {
        console.error("PartnerProfileForm save error:", updateError);
        setError(updateError.message || "Couldn't save your profile — please try again.");
        return;
      }
      if (!data || data.length === 0) {
        setError("Couldn't save your profile — your account wasn't updated. Please try again.");
        return;
      }

      setContactNumber(nextPhone);
      setSaved({ phone: nextPhone, photo });
      setJustSaved(true);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      onChange={() => setJustSaved(false)}
      className="kb-card space-y-4 p-5"
    >
      <div>
        <p className="kb-eyebrow">{role === "rider" ? "Delivery partner" : "Picker"}</p>
        <h2 className="mt-1 font-display text-xl font-bold">{role === "rider" ? "Rider profile" : "Picker profile"}</h2>
      </div>

      <div>
        <span className="mb-1.5 block text-xs font-semibold" style={{ color: "var(--kb-ink-soft)" }}>
          Your photo
        </span>
        <PhotoPicker
          userId={userId}
          name={fullName}
          value={photo}
          onChange={(url) => {
            setPhoto(url);
            setJustSaved(false);
          }}
          onUploadingChange={setPhotoUploading}
          tone="light"
        />
      </div>

      <div>
        <span className="mb-1.5 block text-xs font-semibold" style={{ color: "var(--kb-ink-soft)" }}>
          Full name
        </span>
        <p className="text-sm font-semibold">{fullName || "—"}</p>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold" style={{ color: "var(--kb-ink-soft)" }}>
          Contact number
        </span>
        <input
          required
          type="tel"
          value={contactNumber}
          onChange={(e) => setContactNumber(e.target.value)}
          className="kb-input"
          placeholder="e.g. 91234567"
        />
      </label>

      {error && (
        <p role="alert" className="kb-alert-error rounded-2xl px-4 py-3 text-sm">
          {error}
        </p>
      )}
      {justSaved && !dirty && (
        <p role="status" className="kb-alert-success rounded-2xl px-4 py-3 text-sm">
          Profile saved.
        </p>
      )}

      <button
        type="submit"
        disabled={saving || photoUploading || !dirty}
        className="kb-btn-primary w-full py-3.5 text-[15px]"
      >
        <PendingLabel pending={saving} pendingText="Saving…">Save changes</PendingLabel>
      </button>
    </form>
  );
}

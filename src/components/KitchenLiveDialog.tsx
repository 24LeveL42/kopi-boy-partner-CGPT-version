"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { customerKitchenUrl } from "@/lib/kitchen-live";
import { NEW_TAB } from "@/lib/legal-links";

/**
 * "Your kitchen is live! 🎉" — once, after the cook's first kitchen save
 * (shouldShowKitchenLive decides when). Either button closes it and sets
 * profiles.kitchen_live_seen, so it never comes back.
 */
export function KitchenLiveDialog({ userId }: { userId: string }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;

  const close = () => {
    setOpen(false);
    createClient()
      .from("profiles")
      .update({ kitchen_live_seen: true })
      .eq("id", userId)
      .then(({ error }) => {
        // Not fatal: at worst the cook sees it once more.
        if (error) console.error("Kitchen live pop-up: couldn't record it as seen", error);
      });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6" role="dialog" aria-modal="true" aria-labelledby="kitchen-live-title">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={close} className="absolute inset-0 bg-[#1E143C]/40 backdrop-blur-[2px]" />
      <div className="kb-card-pop kb-sheet-up relative w-full max-w-sm p-6 text-center">
        <h2 id="kitchen-live-title" className="font-display text-2xl font-bold tracking-tight" style={{ color: "var(--kb-ink)" }}>
          Your kitchen is live! 🎉
        </h2>
        <p className="mt-2 text-sm leading-6" style={{ color: "var(--kb-ink-soft)" }}>
          Customers can now find and order from your kitchen on kopi-boy.com. Tap below to see how it looks.
        </p>
        <div className="mt-6 space-y-2">
          <a href={customerKitchenUrl(userId)} {...NEW_TAB} autoFocus onClick={close} className="kb-btn-primary w-full py-3.5 text-[15px]">
            View my kitchen
          </a>
          <button type="button" onClick={close} className="kb-btn-ghost w-full py-3 text-sm">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

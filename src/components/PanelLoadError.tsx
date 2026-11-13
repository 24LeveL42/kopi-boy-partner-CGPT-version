"use client";

import { PANEL_LOAD_ERROR, RETRY_COPY } from "@/lib/onboarding-copy";
import { PendingLabel } from "./Pending";

/** An orders / deliveries list that didn't load, even after its automatic retry. */
export function PanelLoadError({ onRetry, pending, disabled }: { onRetry: () => void; pending: boolean; disabled: boolean }) {
  return (
    <div className="mb-3 rounded-2xl px-4 py-3" role="alert" style={{ background: "#FEF0F0", color: "#B42318" }}>
      <p className="text-sm">{PANEL_LOAD_ERROR}</p>
      <button type="button" onClick={onRetry} disabled={disabled} className="kb-btn-secondary mt-2 w-full py-2.5 text-sm">
        <PendingLabel pending={pending} pendingText={RETRY_COPY.pending}>
          {RETRY_COPY.button}
        </PendingLabel>
      </button>
    </div>
  );
}

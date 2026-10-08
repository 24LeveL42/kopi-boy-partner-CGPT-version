"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePendingAction } from "@/lib/use-pending-action";
import type { PickupRequestWithKitchen } from "@/lib/types-picker";
import { PendingLabel } from "./Pending";
import { PickupChat } from "./PickupChat";

interface KitchenOption {
  id: string;
  business_name: string;
  postal_sector: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  open: "Waiting for a picker",
  accepted: "Picker on the way",
  completed: "Handed off",
  cancelled: "Cancelled",
};

export function RequestPickerForm({
  userId,
  kitchens,
  myRequests,
}: {
  userId: string;
  kitchens: KitchenOption[];
  myRequests: PickupRequestWithKitchen[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const [kitchenId, setKitchenId] = useState(kitchens[0]?.id ?? "");
  const { busy: loading, run, startTransition } = usePendingAction();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!kitchenId) return;

    run("request", async () => {
      setError(null);
      const { error: insertError } = await supabase.from("pickup_requests").insert({
        rider_id: userId,
        kitchen_id: kitchenId,
      });
      if (insertError) {
        setError(insertError.message);
        return;
      }
      // Busy until the refreshed page swaps this form for the request card.
      startTransition(() => router.refresh());
    });
  }

  const openOrActive = myRequests.filter((r) => r.status === "open" || r.status === "accepted");

  return (
    <div>
      {openOrActive.length > 0 ? (
        <div className="space-y-2">
          {openOrActive.map((r) => (
            <div key={r.id} className="kb-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-bold">{r.kitchen_business_name}</p>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--kb-ink-soft)" }}>{r.kitchen_address}</p>
                </div>
                <span
                  className="shrink-0 rounded-full px-3 py-1 text-[11px] font-bold"
                  style={
                    r.status === "accepted"
                      ? { background: "var(--kb-mint)", color: "var(--kb-green-deep)" }
                      : { background: "rgba(245,158,11,0.12)", color: "#B45309" }
                  }
                >
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
              {r.status === "accepted" && (
                <>
                  <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                    Pay the picker directly when they hand off the food (suggested ${r.suggested_fee.toFixed(2)}).
                  </p>
                  {/* Same window as pickup_chat_participant(): only while accepted. */}
                  <PickupChat pickupRequestId={r.id} userId={userId} as="rider" />
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="kb-card-pop p-5">
          <label className="block text-xs font-semibold" style={{ color: "var(--kb-ink-soft)" }}>
            Which kitchen is this pickup for?
          </label>
          <select
            value={kitchenId}
            onChange={(e) => setKitchenId(e.target.value)}
            className="kb-input mt-1.5"
          >
            {kitchens.map((k) => (
              <option key={k.id} value={k.id}>
                {k.business_name}
                {k.postal_sector ? ` — Postal sector ${k.postal_sector}` : ""}
              </option>
            ))}
          </select>
          <p className="mt-3 rounded-xl px-3 py-2 text-xs" style={{ background: "var(--kb-tint)", color: "var(--kb-ink-soft)" }}>
            Suggested fee $2.00, paid directly to the picker — not through Kopi Boy.
          </p>
          <button
            type="submit"
            disabled={loading || !kitchenId}
            className="kb-btn-primary mt-4 w-full py-3.5 text-[15px]"
          >
            <PendingLabel pending={loading} pendingText="Requesting…">Request a picker</PendingLabel>
          </button>
          {error && (
            <p className="kb-alert-error mt-3 rounded-xl px-3 py-2 text-xs">
              {error}
            </p>
          )}
        </form>
      )}

      {myRequests.some((r) => r.status === "completed") && (
        <p className="mt-4 text-center text-xs" style={{ color: "var(--kb-ink-soft)" }}>
          Your completed pickups are handled — continue the delivery as normal.
        </p>
      )}
    </div>
  );
}

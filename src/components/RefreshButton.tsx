"use client";

import { useRouter } from "next/navigation";
import { usePendingAction } from "@/lib/use-pending-action";
import { PendingLabel } from "./Pending";

/**
 * Re-runs the current page's server render (router.refresh) with a busy
 * label: "Try again" on error screens, "Check status" while waiting for HQ.
 * The server side has its own time limit, so this always settles.
 */
export function RefreshButton({
  label,
  pendingText,
  variant = "primary",
}: {
  label: string;
  pendingText: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const { busy, run, startTransition } = usePendingAction();

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => run("refresh", async () => startTransition(() => router.refresh()))}
      className={variant === "primary" ? "kb-btn-primary w-full py-3.5 text-[15px]" : "kb-btn-secondary w-full py-3 text-sm"}
    >
      <PendingLabel pending={busy} pendingText={pendingText}>
        {label}
      </PendingLabel>
    </button>
  );
}

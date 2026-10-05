"use client";

import { useState } from "react";
import { KitchenSetupForm } from "./KitchenSetupForm";
import { StatusScreen } from "./StatusScreen";
import { useBackHandler } from "./AppChrome";
import type { KitchenDefaults } from "@/lib/partner-routing";

/**
 * First-time Kitchen Setup renders at "/" itself, so Cancel has no other page
 * to go to. Cancelling lands on a "setup paused" screen instead — the unsaved
 * form is discarded, and the cook can resume setup or sign out. Back (and Home)
 * on that screen return to setup.
 */
export function KitchenSetupGate({
  userId,
  defaults,
}: {
  userId: string;
  defaults: KitchenDefaults;
}) {
  const [paused, setPaused] = useState(false);
  useBackHandler(paused ? () => setPaused(false) : null);

  if (!paused) {
    return <KitchenSetupForm userId={userId} defaults={defaults} onCancel={() => setPaused(true)} />;
  }

  return (
    <StatusScreen
      tone="warning"
      signOut
      title="Kitchen setup not finished"
      message="Your kitchen isn't live yet, so customers can't order from you. Pick it back up whenever you're ready."
    >
      <button
        type="button"
        onClick={() => setPaused(false)}
        className="w-full rounded-2xl py-3.5 text-[15px] font-semibold text-white"
        style={{ background: "linear-gradient(90deg, var(--kb-purple) 0%, var(--kb-green) 100%)" }}
      >
        Continue kitchen setup
      </button>
    </StatusScreen>
  );
}

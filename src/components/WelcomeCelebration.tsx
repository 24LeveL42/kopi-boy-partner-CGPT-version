"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePendingAction } from "@/lib/use-pending-action";
import { useCelebrationConfetti } from "@/lib/use-celebration-confetti";
import { WELCOME_COPY } from "@/lib/onboarding-copy";
import type { WelcomeLink } from "@/lib/welcome";
import { Logo } from "./Logo";
import { PendingLabel } from "./Pending";

/** The longest the button waits for "celebration seen" to save before moving on. */
const MARK_WAIT_MS = 3000;

/**
 * /welcome: the "You're approved" page the Boss approval email links to.
 * The card shows straight away; light confetti plays over it the first time
 * only (none with reduce motion on). The first time also records
 * profiles.approval_celebrated, so "/" doesn't celebrate a second time.
 */
export function WelcomeCelebration({
  userId,
  title,
  greeting,
  pricing,
  primary,
  secondary,
  confetti,
}: {
  userId: string;
  title: string;
  greeting: string;
  pricing: string | null;
  primary: WelcomeLink;
  secondary: WelcomeLink | null;
  confetti: boolean;
}) {
  const router = useRouter();
  const { busy, run, startTransition } = usePendingAction();
  const marking = useRef<Promise<void> | null>(null);

  useCelebrationConfetti(confetti);

  // Played once: record it straight away (not fatal if it fails: at worst
  // the one-time card on "/" shows as well).
  useEffect(() => {
    if (!confetti || marking.current) return;
    marking.current = Promise.resolve(
      createClient().from("profiles").update({ approval_celebrated: true }).eq("id", userId),
    ).then(
      ({ error }) => {
        if (error) console.error("Welcome: couldn't record the celebration as seen", error);
      },
      (e) => console.error("Welcome: couldn't record the celebration as seen", e),
    );
  }, [confetti, userId]);

  function go() {
    run("go", async () => {
      // Let "seen" save first, so "/" doesn't replay the celebration, but
      // never wait long for it.
      if (marking.current) await Promise.race([marking.current, new Promise((r) => setTimeout(r, MARK_WAIT_MS))]);
      startTransition(() => router.push(primary.href));
    });
  }

  return (
    <main className="kb-page min-h-page overflow-hidden">
      <div className="relative mx-auto flex min-h-page w-full max-w-md flex-col justify-center px-5 py-8">
        <div className="mb-7 flex justify-center">
          <Logo size={52} />
        </div>
        <div className="kb-card-pop kb-sheet-up p-6 text-center">
          <p aria-hidden="true" className="text-4xl">🎉</p>
          <h1 className="mt-3 font-display text-2xl font-bold tracking-tight" style={{ color: "var(--kb-ink)" }}>
            {title}
          </h1>
          <p className="mt-2 text-sm leading-6" style={{ color: "var(--kb-ink-soft)" }}>
            {greeting}
          </p>
          {pricing && (
            <p className="mt-3 rounded-2xl px-4 py-2.5 text-sm font-semibold" style={{ background: "var(--kb-mint)", color: "var(--kb-green-deep)" }}>
              {pricing}
            </p>
          )}
          <button type="button" autoFocus disabled={busy} onClick={go} className="kb-btn-primary mt-6 w-full py-3.5 text-[15px]">
            <PendingLabel pending={busy} pendingText={WELCOME_COPY.opening}>
              {primary.label}
            </PendingLabel>
          </button>
          {secondary && (
            <a
              href={secondary.href}
              target="_blank"
              rel="noopener noreferrer"
              className="kb-btn-secondary mt-3 flex w-full items-center justify-center py-3 text-sm"
            >
              {secondary.label}
            </a>
          )}
        </div>
        <p className="mt-6 text-center text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--kb-ink-soft)" }}>
          Kopi Boy • Partner network
        </p>
      </div>
    </main>
  );
}

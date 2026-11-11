"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CELEBRATION_COLOURS, celebrationGreeting } from "@/lib/approval-celebration";

/** How long the confetti plays before the card slides up. */
const CONFETTI_MS = 2500;

/**
 * The one-time "You're approved" celebration for a newly approved cook or rider:
 * confetti from both bottom corners, three firework bursts in the middle,
 * then a card that slides up. With "reduce motion" on, no confetti, just the
 * card. profiles.approval_celebrated is set when the card appears, so a
 * refresh or Back never replays it.
 *
 * buttonLabel / href: the one button ("Set up my kitchen", "Start
 * delivering") and where it goes. null = the right screen is already behind
 * the card (first-time Kitchen Setup, the rider dashboard), so the button
 * just closes it. Chosen by approvalCelebrationFor().
 */
export function ApprovalCelebration({
  userId,
  fullName,
  buttonLabel,
  href,
}: {
  userId: string;
  fullName: string | null;
  buttonLabel: string;
  href: string | null;
}) {
  const router = useRouter();
  const [showCard, setShowCard] = useState(false);
  const [closed, setClosed] = useState(false);
  const marked = useRef(false);

  // Confetti, then the card.
  useEffect(() => {
    // Reduce motion on: no confetti, the card straight away.
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let reset: (() => void) | null = null;

    // Loaded only here, so normal page loads never pay for it.
    if (!reduceMotion) import("canvas-confetti")
      .then(({ default: confetti }) => {
        if (cancelled) return;
        reset = confetti.reset;
        const base = { colors: CELEBRATION_COLOURS, disableForReducedMotion: true, zIndex: 60 };

        const corners = () => {
          confetti({ ...base, particleCount: 70, angle: 60, spread: 55, startVelocity: 65, origin: { x: 0, y: 1 } });
          confetti({ ...base, particleCount: 70, angle: 120, spread: 55, startVelocity: 65, origin: { x: 1, y: 1 } });
        };
        const firework = (x: number, y: number) =>
          confetti({ ...base, particleCount: 80, spread: 360, startVelocity: 28, ticks: 80, gravity: 0.8, scalar: 0.9, origin: { x, y } });

        corners();
        timers.push(setTimeout(corners, 250));
        timers.push(setTimeout(() => firework(0.5, 0.35), 800));
        timers.push(setTimeout(() => firework(0.3, 0.3), 1400));
        timers.push(setTimeout(() => firework(0.7, 0.32), 2000));
      })
      .catch((e) => console.error("Approval celebration: couldn't load confetti", e));

    // The card comes up on time even if the confetti failed to load.
    timers.push(setTimeout(() => !cancelled && setShowCard(true), reduceMotion ? 0 : CONFETTI_MS));

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      reset?.();
    };
  }, []);

  // Played once: record it as soon as the card is up.
  useEffect(() => {
    if (!showCard || marked.current) return;
    marked.current = true;
    createClient()
      .from("profiles")
      .update({ approval_celebrated: true })
      .eq("id", userId)
      .then(({ error }) => {
        // Not fatal: at worst the cook sees the celebration once more.
        if (error) console.error("Approval celebration: couldn't record it as seen", error);
      });
  }, [showCard, userId]);

  if (!showCard || closed) return null;

  const go = () => {
    setClosed(true);
    if (href) router.push(href);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-labelledby="approved-title">
      <div aria-hidden="true" className="kb-fade-in absolute inset-0 bg-[#1E143C]/40 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-md px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="kb-card-pop kb-sheet-up p-6 text-center">
          <h2 id="approved-title" className="font-display text-2xl font-bold tracking-tight" style={{ color: "var(--kb-ink)" }}>
            🎉 You&apos;re approved!
          </h2>
          <p className="mt-2 text-sm leading-6" style={{ color: "var(--kb-ink-soft)" }}>
            {celebrationGreeting(fullName)}
          </p>
          <button type="button" autoFocus onClick={go} className="kb-btn-primary mt-6 w-full py-3.5 text-[15px]">
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

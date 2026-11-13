"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { celebrationGreeting } from "@/lib/approval-celebration";
import { CONFETTI_MS } from "@/lib/celebration-confetti";
import { useCelebrationConfetti } from "@/lib/use-celebration-confetti";

/**
 * The one-time "You're approved" celebration for a newly approved cook or rider:
 * light confetti from both bottom corners and two small firework bursts,
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

  // Confetti (shared, light: see celebration-confetti.ts), then the card.
  useCelebrationConfetti(true);
  useEffect(() => {
    // Reduce motion on: no confetti, the card straight away.
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => setShowCard(true), reduceMotion ? 0 : CONFETTI_MS);
    return () => clearTimeout(timer);
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

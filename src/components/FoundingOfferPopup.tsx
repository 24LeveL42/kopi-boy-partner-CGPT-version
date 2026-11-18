"use client";

import { useEffect, useRef, useState } from "react";
import { FOUNDING_OFFER_COPY } from "@/lib/onboarding-copy";
import { claimOfferShow, msUntilNextSgMidnight, OFFER_DELAY_MS, offerPhase, type OfferPhase } from "@/lib/founding-offer";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The founding-partner offer (neutral from launch day), on the signed-out
 * landing page only: LoginForm renders it when page.tsx passes showOffer.
 * Opens once per browser session, OFFER_DELAY_MS after the page appears.
 * A fixed overlay, so it never shifts the sign-in card (or its in-app
 * browser banner) underneath. Both buttons lead into the existing Sign up
 * step; cook or rider is chosen after sign-in, as before.
 */
export function FoundingOfferPopup({ onSignUp }: { onSignUp: () => void }) {
  const [phase, setPhase] = useState<OfferPhase | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const open = phase !== null;

  // Open after the delay, once per session. Worked out in the browser only,
  // so the server render never has it (no hydration mismatch).
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!claimOfferShow(sessionStore())) return;
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPhase(offerPhase(new Date()));
    }, OFFER_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  // Live countdown: refresh just after each Singapore midnight (which also
  // switches to the neutral version at launch).
  useEffect(() => {
    if (phase?.kind !== "offer") return;
    const timer = setTimeout(() => setPhase(offerPhase(new Date())), msUntilNextSgMidnight(new Date()) + 1000);
    return () => clearTimeout(timer);
  }, [phase]);

  function close(then?: () => void) {
    setPhase(null);
    then?.();
    // After a Sign up the form has moved on; only go back if the element is still there.
    const back = returnFocusRef.current;
    if (back && back.isConnected && !then) back.focus();
  }

  // Esc closes; Tab stays inside the dialog.
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!phase) return null;
  const copy = FOUNDING_OFFER_COPY;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:px-6">
      <button
        type="button"
        aria-label={copy.close}
        tabIndex={-1}
        onClick={() => close()}
        className="kb-fade-in absolute inset-0 bg-[#1E143C]/40 backdrop-blur-[2px]"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="founding-offer-title"
        className="kb-sheet-up relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[28px] border border-[rgba(124,58,237,0.10)] bg-white shadow-[0_20px_60px_rgba(30,20,60,0.10)] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 text-left motion-reduce:animate-none sm:max-w-md sm:rounded-[28px] sm:p-7"
      >
        <button
          type="button"
          data-autofocus
          aria-label={copy.close}
          onClick={() => close()}
          className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-xl leading-none transition-colors hover:bg-black/5"
          style={{ background: "var(--kb-tint)", color: "var(--kb-ink)" }}
        >
          <span aria-hidden="true">×</span>
        </button>

        {phase.kind === "offer" ? (
          <>
            <p
              className="inline-flex rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em]"
              style={{ background: "rgba(124,58,237,0.08)", color: "var(--kb-purple)" }}
            >
              {copy.offer.badge}
            </p>
            <h2 id="founding-offer-title" className="font-display mt-3 pr-12 text-2xl font-bold tracking-tight" style={{ color: "var(--kb-ink)" }}>
              {copy.offer.headlineLead}{" "}
              <span className="inline-block rounded-xl px-2.5 py-0.5 text-white" style={{ background: "var(--kb-gradient)" }}>
                {copy.offer.headlineChip}
              </span>
            </h2>

            <div
              className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl border px-4 py-3"
              style={{ borderColor: "rgba(245,158,11,0.45)", background: "rgba(245,158,11,0.12)" }}
            >
              <p className="text-sm font-bold" style={{ color: "var(--kb-ink)" }}>
                {copy.offer.deadline}
              </p>
              <p className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold" style={{ color: "#B45309" }}>
                {phase.countdown}
              </p>
            </div>

            <p className="mt-4 rounded-2xl px-4 py-3 text-sm leading-6" style={{ background: "#F5F3FA", color: "var(--kb-ink)" }}>
              {copy.offer.joinEarly}
            </p>

            <ul className="mt-4 space-y-2 text-sm" style={{ color: "var(--kb-ink)" }}>
              {copy.offer.checks.map((check) => (
                <li key={check} className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                    style={{ background: "var(--kb-mint)", color: "var(--kb-green-deep)" }}
                  >
                    ✓
                  </span>
                  <span>{check}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <h2 id="founding-offer-title" className="font-display pr-12 text-xl font-bold leading-snug tracking-tight" style={{ color: "var(--kb-ink)" }}>
            {copy.neutral.headline}
          </h2>
        )}

        <OfferButtons onSignUp={() => close(onSignUp)} finePrint={phase.kind === "offer" ? copy.offer.finePrint : copy.neutral.finePrint} />
      </div>
    </div>
  );
}

function OfferButtons({ onSignUp, finePrint }: { onSignUp: () => void; finePrint: string }) {
  const copy = FOUNDING_OFFER_COPY.offer;
  return (
    <>
      <button
        type="button"
        onClick={onSignUp}
        className="mt-5 w-full rounded-2xl px-5 py-3.5 text-[15px] font-bold text-white shadow-lg transition-all hover:-translate-y-0.5"
        style={{ background: "var(--kb-gradient)" }}
      >
        {copy.cookButton}
      </button>
      <p className="mt-3 rounded-2xl px-4 py-2.5 text-center text-sm" style={{ background: "var(--kb-mint)", color: "var(--kb-green-deep)" }}>
        {copy.riderStrip}{" "}
        <button type="button" onClick={onSignUp} className="font-bold underline underline-offset-2">
          {copy.riderLink}
        </button>
      </p>
      <p className="mt-3 text-center text-[11px] leading-4" style={{ color: "var(--kb-ink-soft)" }}>
        {finePrint}
      </p>
    </>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
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
  // If the mascot can't load, it's dropped and the top row closes up.
  const [mascotOk, setMascotOk] = useState(true);
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
        className="kb-sheet-up relative w-full text-left motion-reduce:animate-none sm:mt-[84px] sm:max-w-md"
      >
        {mascotOk ? <Mascot onError={() => setMascotOk(false)} /> : null}
        {/* The card is capped below the screen height by the mascot's overhang, so the mascot is never cut off. */}
        <div className="relative flex max-h-[calc(100dvh-48px)] flex-col overflow-hidden rounded-t-[28px] border border-[rgba(124,58,237,0.10)] bg-white shadow-[0_20px_60px_rgba(30,20,60,0.10)] sm:max-h-[calc(100dvh-96px)] sm:rounded-[28px]">
        {/* Outside the scrolling part, so it is always reachable; above the mascot. */}
        <button
          type="button"
          data-autofocus
          aria-label={copy.close}
          onClick={() => close()}
          className="absolute right-3 top-3 z-30 flex h-11 w-11 items-center justify-center rounded-full text-xl leading-none transition-colors hover:bg-black/5"
          style={{ background: "var(--kb-tint)", color: "var(--kb-ink)" }}
        >
          <span aria-hidden="true">×</span>
        </button>

        {/* Only this part scrolls, if a short screen needs it; the button stays put. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-3 sm:px-7 sm:pt-7">
          {/* Top row, beside the mascot (which covers the card's top-left corner) and left of the X. */}
          <div className={`flex min-h-[26px] items-center ${mascotOk ? "pl-[92px] sm:pl-[66px]" : ""}`}>
            {phase.kind === "offer" ? (
              <p
                className="inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] sm:px-3 sm:text-[11px] sm:tracking-[0.16em]"
                style={{ background: "rgba(124,58,237,0.08)", color: "var(--kb-purple)" }}
              >
                {copy.offer.badge}
              </p>
            ) : null}
          </div>
          {phase.kind === "offer" ? (
            <>
              <h2 id="founding-offer-title" className="font-display mt-2 text-[22px] font-bold leading-tight tracking-tight sm:text-2xl" style={{ color: "var(--kb-ink)" }}>
                {copy.offer.headlineLead}{" "}
                <span className="inline-block rounded-xl px-2.5 py-0.5 text-white" style={{ background: "var(--kb-gradient)" }}>
                  {copy.offer.headlineChip}
                </span>
              </h2>

              <div
                className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl border px-4 py-1.5 sm:mt-3 sm:py-2.5"
                style={{ borderColor: "rgba(245,158,11,0.45)", background: "rgba(245,158,11,0.12)" }}
              >
                <p className="text-sm font-bold" style={{ color: "var(--kb-ink)" }}>
                  {copy.offer.deadline}
                </p>
                <p className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold" style={{ color: "#B45309" }}>
                  {phase.countdown}
                </p>
              </div>

              <p className="mt-2 rounded-2xl px-4 py-1.5 text-[13px] leading-5 sm:mt-3 sm:py-2.5 sm:text-sm sm:leading-6" style={{ background: "#F5F3FA", color: "var(--kb-ink)" }}>
                {copy.offer.joinEarly}
              </p>

              <ul className="mt-2 space-y-0.5 text-[13px] leading-5 sm:mt-3 sm:space-y-1.5 sm:text-sm" style={{ color: "var(--kb-ink)" }}>
                {copy.offer.checks.map((check) => (
                  <li key={check} className="flex items-start gap-2.5">
                    <span
                      aria-hidden="true"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
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
            <h2 id="founding-offer-title" className="font-display mt-2 pr-12 text-xl font-bold leading-snug tracking-tight" style={{ color: "var(--kb-ink)" }}>
              {copy.neutral.headline}
            </h2>
          )}

          <SetupHelp />
        </div>

        <OfferButtons onSignUp={() => close(onSignUp)} finePrint={phase.kind === "offer" ? copy.offer.finePrint : copy.neutral.finePrint} />
        </div>
      </div>
    </div>
  );
}

/**
 * K3, decorative. Phone: 96px, top-left, peeking above the sheet. Desktop:
 * 150px over the card's top-left corner. Positioned absolutely with fixed
 * width/height, so it never moves anything; loads only when the pop-up
 * opens; can't take taps or focus (the X sits above it, z-30).
 */
function Mascot({ onError }: { onError: () => void }) {
  return (
    <Image
      src="/mascot/k3-thumbs-up.webp"
      width={360}
      height={334}
      alt=""
      aria-hidden="true"
      draggable={false}
      unoptimized
      loading="eager"
      onError={onError}
      className="pointer-events-none absolute -top-12 left-3 z-20 h-auto w-24 select-none sm:-left-16 sm:-top-[84px] sm:w-[150px]"
    />
  );
}

/** Optional, free kitchen setup help: a soft green card, set apart from the checks. */
function SetupHelp() {
  const copy = FOUNDING_OFFER_COPY.setupHelp;
  return (
    <div className="mt-2 rounded-2xl border px-3.5 py-1.5 sm:mt-3 sm:py-2.5" style={{ borderColor: "rgba(16,185,129,0.35)", background: "var(--kb-mint)" }}>
      <p
        className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.1em]"
        style={{ color: "var(--kb-green-deep)" }}
      >
        <WrenchIcon />
        {copy.badge}
      </p>
      <p className="mt-1 text-[13px] leading-5" style={{ color: "var(--kb-green-deep)" }}>
        {copy.line}
      </p>
    </div>
  );
}

function WrenchIcon() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function OfferButtons({ onSignUp, finePrint }: { onSignUp: () => void; finePrint: string }) {
  const copy = FOUNDING_OFFER_COPY.offer;
  return (
    <div className="shrink-0 px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 sm:px-7 sm:pb-7 sm:pt-3">
      <button
        type="button"
        onClick={onSignUp}
        className="w-full rounded-2xl px-5 py-3.5 text-[15px] font-bold text-white shadow-lg transition-all hover:-translate-y-0.5"
        style={{ background: "var(--kb-gradient)" }}
      >
        {copy.cookButton}
      </button>
      <p className="mt-2 text-center text-[13px] leading-5" style={{ color: "var(--kb-ink-soft)" }}>
        {copy.riderStrip}{" "}
        {/* The ::before strip makes the tap area 44px tall without changing the look. */}
        <button
          type="button"
          onClick={onSignUp}
          className="relative font-bold underline underline-offset-2 before:absolute before:inset-x-0 before:-inset-y-3 before:content-['']"
          style={{ color: "var(--kb-purple)" }}
        >
          {copy.riderLink}
        </button>
      </p>
      <p className="mt-1 text-center text-[11px] leading-4 sm:mt-1.5" style={{ color: "var(--kb-ink-soft)" }}>
        {finePrint}
      </p>
    </div>
  );
}

import { FOUNDING_OFFER_COPY, FOUNDING_OFFER_ENDS_AT } from "./onboarding-copy.ts";

/**
 * Which version of the offer pop-up to show, and its countdown, worked out
 * in Singapore time (UTC+8, no daylight saving) from FOUNDING_OFFER_ENDS_AT.
 */
const SG_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ENDS_AT_MS = Date.parse(FOUNDING_OFFER_ENDS_AT);

/** Days since 1970-01-01 on Singapore's calendar. */
const sgDay = (ms: number) => Math.floor((ms + SG_OFFSET_MS) / DAY_MS);

export type OfferPhase = { kind: "offer"; countdown: string } | { kind: "neutral" };

export function offerPhase(now: Date): OfferPhase {
  const ms = now.getTime();
  if (!(ms < ENDS_AT_MS)) return { kind: "neutral" };
  // Calendar days to launch day: 33 on 19 Nov 2026, 1 on 21 Dec 2026.
  const days = sgDay(ENDS_AT_MS) - sgDay(ms);
  return { kind: "offer", countdown: days <= 1 ? FOUNDING_OFFER_COPY.lastDay : FOUNDING_OFFER_COPY.daysLeft(days) };
}

/** Milliseconds until the countdown text can next change (the next Singapore midnight). */
export function msUntilNextSgMidnight(now: Date): number {
  const ms = now.getTime();
  return (sgDay(ms) + 1) * DAY_MS - SG_OFFSET_MS - ms;
}

/** How long after the page appears the pop-up opens. */
export const OFFER_DELAY_MS = 600;

export const OFFER_SEEN_KEY = "kb-founding-offer-seen";

/** Page-load fallback when sessionStorage can't be used (private mode, blocked storage). */
let shownThisPageLoad = false;

/**
 * True the first time it's asked in a browser session, and records that the
 * pop-up has been shown. When storage throws, once per page load instead.
 */
export function claimOfferShow(storage: Pick<Storage, "getItem" | "setItem"> | null | undefined): boolean {
  try {
    if (!storage) throw new Error("no sessionStorage");
    if (storage.getItem(OFFER_SEEN_KEY)) return false;
    storage.setItem(OFFER_SEEN_KEY, "1");
    return true;
  } catch {
    if (shownThisPageLoad) return false;
    shownThisPageLoad = true;
    return true;
  }
}

/** Tests only: forget the page-load fallback. */
export function resetOfferPageLoadForTests() {
  shownThisPageLoad = false;
}

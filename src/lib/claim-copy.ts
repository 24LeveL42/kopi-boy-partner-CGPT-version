import type { ClaimResultStatus } from "./assisted-claim.ts";
import { KITCHEN_TERMS } from "./kitchen-profile.ts";

/** Everything the /claim page says. English, short sentences, for owners reading on a phone. */

export const CLAIM_STATUS_COPY: Record<Exclude<ClaimResultStatus, "ok">, { title: string; message: string }> = {
  invalid: {
    title: "This link doesn't work",
    message: "Please open the full link Kopi Boy sent you on WhatsApp. If it still doesn't work, ask Kopi Boy for a new link.",
  },
  expired: {
    title: "This link has expired",
    message: "This link has expired, ask Kopi Boy for a new link.",
  },
  used: {
    title: "This link has already been used",
    message: "This shop has already been claimed. If that was you and you are now signed out, ask Kopi Boy to send you a sign-in link on WhatsApp.",
  },
  revoked: {
    title: "This link has been replaced",
    message: "Kopi Boy sent you a newer link. Please use the latest link, or ask Kopi Boy for a new one.",
  },
  cancelled: {
    title: "This shop set-up was cancelled",
    message: "Please contact Kopi Boy if you would still like to join.",
  },
  rate_limited: {
    title: "Too many tries",
    message: "Please wait 15 minutes, then open the link again.",
  },
  error: {
    title: "Something went wrong",
    message: "Nothing was saved. Please check your internet and try again. If it keeps happening, ask Kopi Boy for help.",
  },
};

/** No token in the address: /claim opened directly, or the app opened from the home screen. */
export const NO_TOKEN_COPY = {
  title: "Open your Kopi Boy link",
  message: "Open the link Kopi Boy sent you on WhatsApp again.",
};

/**
 * Signed out in the home-screen app (iPhone keeps a separate sign-in there).
 * Assisted owners have no email or Google sign-in; PIN login comes in v1.1.
 */
export const SIGNED_OUT_OWNER_COPY = {
  title: "You're signed out",
  message: "If Kopi Boy set up your shop for you, ask Kopi Boy for a new link to sign in again.",
};

/** The /resume page: HQ's sign-in link for an owner whose shop is already claimed. */
export const RESUME_COPY = {
  eyebrow: "Kopi Boy sign-in link",
  title: "Sign in to your shop",
  message: "Tap the button to sign back in to your Kopi Boy shop. Your shop, menu and photos stay as they are.",
  button: "Sign me in",
  busy: "Signing you in…",
};

/** /resume opened with no token: directly, or from the home screen. */
export const RESUME_NO_TOKEN_COPY = {
  title: "Open your sign-in link",
  message: "Open the sign-in link Kopi Boy sent you on WhatsApp again.",
};

/** What /resume says when the sign-in link can't be used. Nothing in the shop changes in any of these. */
export const RESUME_STATUS_COPY: Record<Exclude<ClaimResultStatus, "ok">, { title: string; message: string }> = {
  invalid: {
    title: "This link doesn't work",
    message: "Please open the full sign-in link Kopi Boy sent you on WhatsApp. If it still doesn't work, ask Kopi Boy for a new sign-in link.",
  },
  expired: {
    title: "This link has expired",
    message: "Sign-in links last 2 hours. Ask Kopi Boy for a new sign-in link.",
  },
  used: {
    title: "This link has already been used",
    message: "Each sign-in link works once. If you are signed out, ask Kopi Boy for a new sign-in link.",
  },
  revoked: {
    title: "This link has been replaced",
    message: "Kopi Boy sent you a newer sign-in link. Please use the latest link, or ask Kopi Boy for a new one.",
  },
  cancelled: {
    title: "This shop is no longer set up",
    message: "Please contact Kopi Boy.",
  },
  rate_limited: {
    title: "Too many tries",
    message: "Please wait 15 minutes, then open the link again.",
  },
  error: {
    title: "Something went wrong",
    message: "You are not signed in yet, and nothing in your shop was changed. Please try again. If it still doesn't work, ask Kopi Boy for a new sign-in link.",
  },
};

export const PARTNER_TERMS_SENTENCE = KITCHEN_TERMS;

export function claimStatement(shopName: string): string {
  return `By tapping I acknowledge, you claim ${shopName} as its owner and agree to Kopi Boy's Terms of Use and Privacy Policy above. You are responsible for food safety, hygiene, pricing and the orders you accept. Kopi Boy doesn't process payments.`;
}

export const CLAIM_BUTTON = "I acknowledge";
export const READ_TICK = "I have read the Terms of Use and Privacy Policy";
export const TICK_HINT = "Read the Terms of Use and Privacy Policy, then tick the box to continue.";

/** The claim button works only once the owner ticks "I have read" (scrolling alone isn't enough), and not while a claim is being sent. */
export function canClaimShop({ ticked, busy }: { ticked: boolean; busy: boolean }): boolean {
  return ticked && !busy;
}

/** On /kitchen while the kitchen isn't live yet. */
export const PAYNOW_TO_GO_LIVE = {
  title: "Add your PayNow to go live",
  message: "Customers pay you directly by PayNow. Fill in your PayNow below and tap Save changes. Your shop goes live straight away.",
  action: "Go to PayNow",
};

/** On the cook dashboard while kitchens.is_live is false. */
export const NOT_LIVE_BANNER = {
  title: "Your shop is not live yet",
  message: "Customers can't see your shop until you add your PayNow.",
  action: "Add PayNow",
};

export function formatPrice(price: number): string {
  return `S$${Number(price).toFixed(2)}`;
}

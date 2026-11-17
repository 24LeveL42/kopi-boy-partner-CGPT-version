/**
 * Words for the sign-up journey screens: application received, the HQ
 * (admin) account screen, "almost there", load errors and /welcome.
 * Pricing is "0% commission" and "S$29.95/month subscription" only, never
 * GST, tax or a free month (checked in onboarding-copy.test.ts).
 */

/** Shown to cooks only. */
export const COOK_PRICING_LINE = "0% commission. S$29.95/month subscription.";

export const PENDING_COPY = {
  title: "Application received",
  message:
    "Thanks for applying! We're reviewing it. We usually review applications within 2 working days, and we'll email you as soon as you're approved.",
  stepsTitle: "What happens next",
  steps: {
    cook: ["We review your application", "You get an approval email", "You set up your kitchen and go live"],
    rider: ["We review your application", "You get an approval email", "You start delivering"],
  },
  checkStatus: "Check status",
  checking: "Checking…",
} as const;

export const STAFF_ACCOUNT_COPY = {
  title: "This is a Kopi Boy HQ account",
  message:
    "HQ accounts can't run a kitchen or ride. To try the partner journey, sign out and sign in with a different Google account.",
} as const;

export const APPROVAL_FINISHING_COPY = {
  title: "Almost there",
  message: "Your application is approved. HQ is finishing setting up your account. Please check again in a few minutes.",
  checkAgain: "Check again",
  checking: "Checking…",
} as const;

export const LOAD_ERROR_COPY = {
  title: "We couldn't load your account",
  message: "Check your connection and try again.",
} as const;

export const KITCHEN_LOAD_ERROR_COPY = {
  title: "Couldn't load your kitchen",
  message: "Something went wrong loading your kitchen. Check your connection and try again.",
} as const;

/** Orders / deliveries panels, after the automatic retry has also failed. */
export const PANEL_LOAD_ERROR = "We couldn't load this list. Check your connection and try again.";

export const RETRY_COPY = {
  button: "Try again",
  pending: "Trying again…",
} as const;

export const WELCOME_COPY = {
  cookTitle: "Your kitchen is approved!",
  riderTitle: "You're approved to ride!",
  setUpKitchen: "Set up my kitchen",
  openKitchen: "Open my kitchen",
  seeItLive: "See it live",
  startDelivering: "Start delivering",
  opening: "Opening…",
} as const;

export const IN_APP_BROWSER_COPY = {
  title: "Open in your browser to sign in",
  message: "To sign in, tap the ⋮ (or share) icon and choose 'Open in browser' (Chrome or Safari).",
  /** Under the button: why, and the copy-link route. */
  note: "Google sign-in doesn't work inside apps like Facebook, Instagram, TikTok, WeChat or LINE. Or copy the link and paste it into Chrome or Safari.",
  copyLink: "Copy link",
  copied: "Link copied. Now paste it into Chrome or Safari.",
  copyFailed: "Couldn't copy. Please use the ⋮ (or share) icon instead.",
} as const;

/** The Google button gives up waiting after this long (or when the user comes Back). */
export const GOOGLE_WAIT_MS = 20_000;
export const GOOGLE_SLOW_MESSAGE = "Still waiting for Google. Please try again.";

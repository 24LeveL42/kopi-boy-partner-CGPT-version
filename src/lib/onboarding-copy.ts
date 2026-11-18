/**
 * Words for the sign-up journey screens: application received, the HQ
 * (admin) account screen, "almost there", load errors and /welcome.
 * Pricing is "0% commission" and "S$29.95/month subscription" only, never
 * GST or tax. Free months appear only in the founding-partner offer pop-up
 * (FOUNDING_OFFER_COPY) before launch (checked in onboarding-journey.test.ts).
 */

/** The cook subscription after any free period. */
export const COOK_MONTHLY_PRICE = "S$29.95";

/** Shown to cooks only. */
export const COOK_PRICING_LINE = `0% commission. ${COOK_MONTHLY_PRICE}/month subscription.`;

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
  title: "To use Google, open in your browser",
  message: "Google sign-in doesn't work inside this app. To use Google, tap the ⋮ or ⋯ (or share) icon and choose 'Open in browser'. Or continue with email below.",
  /** Under the button: why, and the copy-link route. */
  note: "To use Google, you can also copy the link and paste it into Chrome or Safari.",
  copyLink: "Copy link",
  copied: "Link copied. Now paste it into Chrome or Safari.",
  copyFailed: "Couldn't copy. Please use the ⋮ or ⋯ (or share) icon instead.",
} as const;

/** The Google button gives up waiting after this long (or when the user comes Back). */
export const GOOGLE_WAIT_MS = 20_000;
export const GOOGLE_SLOW_MESSAGE = "Still waiting for Google. Please try again.";

/**
 * Launch day, and the switch for the offer pop-up: before this instant it
 * shows the founding-partner offer, from it the neutral version. The only
 * place the date lives; every date below is worked out from it.
 */
export const FOUNDING_OFFER_ENDS_AT = "2026-12-22T00:00:00+08:00";

/** Length of the founding partners' free period, from launch day. */
export const FOUNDING_FREE_MONTHS = 3;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The launch date's Singapore calendar day, months later (no day overflow: the 22nd always exists). */
function launchDay(monthsLater = 0) {
  const [y, m, d] = FOUNDING_OFFER_ENDS_AT.slice(0, 10).split("-").map(Number);
  const total = m - 1 + monthsLater;
  return { year: y + Math.floor(total / 12), month: total % 12, day: d };
}
const shortDate = ({ day, month }: { day: number; month: number }) => `${day} ${MONTHS[month]}`;
const longDate = (d: { day: number; month: number; year: number }) => `${shortDate(d)} ${d.year}`;

const LAUNCH_LONG = longDate(launchDay()); // "22 Dec 2026"
const LAUNCH_SHORT = shortDate(launchDay()); // "22 Dec"
const FREE_UNTIL = longDate(launchDay(FOUNDING_FREE_MONTHS)); // "22 Mar 2027"
const FREE_MONTHS_WORDS = `${FOUNDING_FREE_MONTHS} months`;

/** Same two buttons in both versions. */
const OFFER_BUTTONS = {
  cookButton: "Sign up as a cook, it's free",
  riderStrip: "Riders: free to join, free to use.",
  riderLink: "Join as a rider →",
} as const;

/**
 * The offer pop-up on the signed-out landing page (FoundingOfferPopup).
 * No cap wording (limited spots, first 100…), and nothing suggesting that
 * joining earlier gives more free months: everyone's free months run from
 * launch day.
 */
export const FOUNDING_OFFER_COPY = {
  close: "Close",
  offer: {
    badge: "FOUNDING PARTNER OFFER",
    headlineLead: "Cooks:",
    headlineChip: `${FREE_MONTHS_WORDS.toUpperCase()} FREE`,
    deadline: `Join before ${LAUNCH_LONG}`,
    joinEarly: `Join early and set up your kitchen now, so you're ready to take orders on launch day, ${LAUNCH_SHORT}. Your ${FOUNDING_FREE_MONTHS} free months run from ${LAUNCH_LONG} to ${FREE_UNTIL}. We'll set up your kitchen for you, free.`,
    checks: [
      "Registration is free",
      "0% commission. You keep 100% of what customers pay you",
      "No credit or debit card needed",
      `No lock-in. Don't want to continue after ${FREE_MONTHS_WORDS}? Just stop`,
    ],
    ...OFFER_BUTTONS,
    finePrint: `Offer for kitchens registering before ${LAUNCH_LONG}. After the free period: ${COOK_MONTHLY_PRICE}/month, cancel anytime.`,
  },
  neutral: {
    headline: "Registration is free. 0% commission. Riders always free.",
    ...OFFER_BUTTONS,
    finePrint: `Cooks: ${COOK_MONTHLY_PRICE}/month, cancel anytime.`,
  },
  /** The countdown beside the deadline. */
  daysLeft: (n: number) => (n === 1 ? "1 day left" : `${n} days left`),
  lastDay: "Last day to join",
} as const;

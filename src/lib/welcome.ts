import type { Profile } from "./types-auth";
import type { PartnerScreen } from "./partner-routing";
import type { PartnerKitchen } from "./partner-state";
import { celebrationGreeting } from "./approval-celebration.ts";
import { customerKitchenUrl } from "./kitchen-live.ts";
import { COOK_PRICING_LINE, WELCOME_COPY } from "./onboarding-copy.ts";

/** Where /welcome sends a signed-out visitor: sign in, then straight back here. */
export const WELCOME_LOGIN_PATH = "/login?next=/welcome";

export interface WelcomeLink {
  label: string;
  href: string;
}

export type WelcomeDecision =
  | { kind: "redirect"; to: string }
  | { kind: "staff-account" }
  | { kind: "approval-finishing" }
  | {
      kind: "celebrate";
      role: "cook" | "rider";
      title: string;
      greeting: string;
      /** Cooks only. */
      pricing: string | null;
      primary: WelcomeLink;
      /** "See it live" on the Customer site, for a live, unblocked kitchen. */
      secondary: WelcomeLink | null;
      /**
       * Confetti only the first time (profiles.approval_celebrated still
       * false). Already celebrated, or the column not there yet: a calm card.
       */
      confetti: boolean;
    };

/**
 * /welcome is the page the Boss approval email links to. It celebrates only
 * a partner who really is approved; everyone else goes where "/" would put
 * them (sign in, "Application received", rejected, blocked, apply), and
 * never sees the celebration.
 */
export function welcomeDecision({
  signedIn,
  screen,
  profile,
  kitchen,
}: {
  signedIn: boolean;
  screen: PartnerScreen | null;
  profile: Pick<Profile, "full_name" | "approval_celebrated"> | null;
  kitchen: Pick<PartnerKitchen, "id" | "is_live" | "is_blocked"> | null;
}): WelcomeDecision {
  if (!signedIn || !screen) return { kind: "redirect", to: WELCOME_LOGIN_PATH };

  const confetti = profile?.approval_celebrated === false;
  const greeting = celebrationGreeting(profile?.full_name);

  switch (screen.kind) {
    case "staff-account":
      return { kind: "staff-account" };
    case "approval-finishing":
      return { kind: "approval-finishing" };
    case "kitchen-setup":
      return {
        kind: "celebrate",
        role: "cook",
        title: WELCOME_COPY.cookTitle,
        greeting,
        pricing: COOK_PRICING_LINE,
        primary: { label: WELCOME_COPY.setUpKitchen, href: "/" },
        secondary: null,
        confetti,
      };
    case "partner-shell": {
      if (screen.view === "rider") {
        return {
          kind: "celebrate",
          role: "rider",
          title: WELCOME_COPY.riderTitle,
          greeting,
          pricing: null,
          primary: { label: WELCOME_COPY.startDelivering, href: "/" },
          secondary: null,
          confetti,
        };
      }
      const live = !!kitchen && kitchen.is_live === true && kitchen.is_blocked !== true;
      return {
        kind: "celebrate",
        role: "cook",
        title: WELCOME_COPY.cookTitle,
        greeting,
        pricing: COOK_PRICING_LINE,
        primary: { label: WELCOME_COPY.openKitchen, href: "/" },
        secondary: live ? { label: WELCOME_COPY.seeItLive, href: customerKitchenUrl(kitchen.id) } : null,
        confetti,
      };
    }
    // Not approved (pending, rejected, blocked, no application) or the
    // kitchen didn't load: "/" shows the right screen for each.
    case "application-pending":
    case "application-rejected":
    case "blocked":
    case "apply":
    case "kitchen-load-error":
      return { kind: "redirect", to: "/" };
  }
}

import type { Profile } from "./types-auth";
import type { PartnerScreen } from "./partner-routing";

// Shared with /welcome (lighter bursts, see celebration-confetti.ts).
export { CELEBRATION_COLOURS } from "./celebration-confetti.ts";

/** What the card's one button says, and where it goes (null = just close the card). */
export interface ApprovalCelebration {
  buttonLabel: string;
  href: string | null;
}

/**
 * The one-time "You're approved" celebration, for cooks and riders whose
 * profile says they haven't seen it yet:
 *  - Kitchen Setup (a new cook): setup is the screen behind the card, so
 *    "Set up my kitchen" just closes it.
 *  - The cook dashboard: "Set up my kitchen" goes to /kitchen.
 *  - The rider dashboard: "Start delivering" just closes the card, since
 *    the dashboard is the screen behind it.
 * Applicants, rejected and blocked accounts and the retired picker role never
 * reach these screens, so they never get it. A missing column
 * (docs/supabase-approval-celebration.sql not run yet) counts as "already
 * celebrated", so nothing shows.
 */
export function approvalCelebrationFor(
  screen: PartnerScreen,
  profile: Pick<Profile, "approval_celebrated"> | null,
): ApprovalCelebration | null {
  if (profile?.approval_celebrated !== false) return null;
  if (screen.kind === "kitchen-setup") return { buttonLabel: "Set up my kitchen", href: null };
  if (screen.kind === "partner-shell") {
    return screen.view === "cook"
      ? { buttonLabel: "Set up my kitchen", href: "/kitchen" }
      : { buttonLabel: "Start delivering", href: null };
  }
  return null;
}

/**
 * "Welcome to the Kopi Boy family, Tan Ah Hock!" — the whole full_name (not
 * the first word: many names are written surname first), with runs of spaces
 * tidied. Without the name if there isn't one.
 */
export function celebrationGreeting(fullName: string | null | undefined): string {
  const name = fullName?.trim().replace(/\s+/g, " ");
  return name ? `Welcome to the Kopi Boy family, ${name}!` : "Welcome to the Kopi Boy family!";
}

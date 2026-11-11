import type { Profile } from "./types-auth";
import type { PartnerScreen } from "./partner-routing";

/** The Customer app (kopi-boy.com) shows a kitchen at /merchant/{kitchen id}; a kitchen's id is the cook's user id. */
export const CUSTOMER_SITE_URL = "https://kopi-boy.com";

export function customerKitchenUrl(kitchenId: string): string {
  return `${CUSTOMER_SITE_URL}/merchant/${encodeURIComponent(kitchenId)}`;
}

/** The welcome banner on Kitchen Setup, while the cook has never saved a kitchen. */
export const KITCHEN_WELCOME_BANNER =
  "Set up your menu and prices below. Once you save, customers can see your kitchen on kopi-boy.com.";

/**
 * The one-time "Your kitchen is live!" pop-up, after a cook's first kitchen
 * save: on the cook dashboard, while profiles.kitchen_live_seen is false
 * (docs/supabase-kitchen-live.sql backfills it for every kitchen saved before
 * then). Never for a kitchen that isn't live (its customer page would be a
 * 404) or that HQ has blocked, and never on top of the approval celebration:
 * that comes first, this one on the next visit. A missing column (the SQL
 * not run yet) counts as "already seen", so nothing shows.
 */
export function shouldShowKitchenLive({
  screen,
  profile,
  kitchen,
  approvalCelebrationShowing,
}: {
  screen: PartnerScreen;
  profile: Pick<Profile, "kitchen_live_seen"> | null;
  kitchen: { is_live?: boolean | null; is_blocked?: boolean | null } | null;
  approvalCelebrationShowing: boolean;
}): boolean {
  return (
    screen.kind === "partner-shell" &&
    screen.view === "cook" &&
    profile?.kitchen_live_seen === false &&
    kitchen?.is_live === true &&
    kitchen.is_blocked !== true &&
    !approvalCelebrationShowing
  );
}

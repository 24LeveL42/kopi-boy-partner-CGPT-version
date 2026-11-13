import type { Profile, CookApplication, RiderApplication } from "./types-auth";
import type { MerchantCategory } from "./types-kitchen";
import { categoryForBusinessType } from "./kitchen-profile.ts";

/**
 * Everything the signed-in home route (`/`) needs to decide which screen to
 * show. Kept as plain data so the decision below is a pure function that can
 * be checked without a database.
 */
export interface PartnerRoutingInput {
  profile: Profile | null;
  cookApp: CookApplication | null;
  riderApp: RiderApplication | null;
  /** The cook's kitchens row (public columns only), or null when there isn't one. */
  kitchen: { id: string } | null;
  /**
   * The kitchen couldn't be loaded (as opposed to "there isn't one"). Then a
   * cook is never sent to Kitchen Setup: saving it would overwrite a kitchen
   * that may well exist.
   */
  kitchenError?: boolean;
}

/** What first-time Kitchen Setup is pre-filled with, taken from the cook application. */
export interface KitchenDefaults {
  business_name: string;
  category: MerchantCategory;
  business_address: string;
  postal_code: string;
  latitude: number | null;
  longitude: number | null;
  description: string;
}

export type PartnerScreen =
  | { kind: "blocked" }
  | { kind: "apply" }
  /** HQ (admin) accounts never run a kitchen or ride: a screen of their own, no apply form. */
  | { kind: "staff-account" }
  | { kind: "application-pending"; as: "cook" | "rider" }
  | { kind: "application-rejected" }
  | { kind: "kitchen-setup"; defaults: KitchenDefaults }
  | { kind: "kitchen-load-error" }
  | { kind: "partner-shell"; view: "cook" | "rider" }
  /**
   * The application is approved but profiles.role hasn't been switched to
   * cook / rider yet. The database only lets a cook save a kitchen and a
   * rider take deliveries (RLS checks user_has_role), so sending them to
   * Kitchen Setup or the rider dashboard now would only end in a refused save.
   */
  | { kind: "approval-finishing"; as: "cook" | "rider" };

function kitchenSetupFor(app: CookApplication): PartnerScreen {
  return {
    kind: "kitchen-setup",
    defaults: {
      business_name: app.business_name,
      category: categoryForBusinessType(app.business_type),
      business_address: app.business_address ?? "",
      postal_code: app.postal_code ?? "",
      latitude: null,
      longitude: null,
      description: app.description ?? "",
    },
  };
}

/**
 * Invariant: Kitchen Setup is only ever reached through a cook application.
 * A profile with no cook application must never land there — a stale
 * `profiles.role = 'cook'` left behind after the application row is gone
 * falls through to the application check below, and with no application of
 * any kind that ends at the "Join as a partner" screen (`apply`).
 */
export function resolvePartnerScreen({
  profile,
  cookApp,
  riderApp,
  kitchen,
  kitchenError = false,
}: PartnerRoutingInput): PartnerScreen {
  // "Saved kitchen → shell, none → setup", unless the kitchen didn't load.
  const cookScreen = (app: CookApplication): PartnerScreen =>
    kitchen ? { kind: "partner-shell", view: "cook" } : kitchenError ? { kind: "kitchen-load-error" } : kitchenSetupFor(app);

  // HQ accounts first: an admin who applied (or was approved) must never
  // land in the partner flow, and is never offered the apply form.
  if (profile?.role === "admin") return { kind: "staff-account" };

  // The retired picker role has no screen of its own. A blocked one stays
  // blocked; an active one is treated as not a partner yet, so they can
  // apply as a cook or rider like anyone else.
  if (profile?.role === "picker" && !profile.is_active) return { kind: "blocked" };

  // Approved and active partner — show the real cook/rider shell.
  if (profile && (profile.role === "cook" || profile.role === "rider")) {
    if (!profile.is_active) return { kind: "blocked" };

    if (profile.role === "rider") return { kind: "partner-shell", view: "rider" };

    // Cook: a saved kitchen means setup is done; otherwise setup needs the
    // cook application it was seeded from.
    if (kitchen) return { kind: "partner-shell", view: "cook" };
    if (cookApp) return cookScreen(cookApp);
    // Role says cook but there's no cook application — stale state, so
    // don't trust the role; fall through to the application check.
  }

  // Not (validly) a partner yet — route by the most recent application.
  const applications = [
    cookApp && { kind: "cook" as const, status: cookApp.status, created_at: cookApp.created_at },
    riderApp && { kind: "rider" as const, status: riderApp.status, created_at: riderApp.created_at },
  ]
    .filter((a) => !!a)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const latest = applications[0];

  // No application of any kind: always the join/apply screen.
  if (!latest) return { kind: "apply" };

  if (latest.status === "pending") return { kind: "application-pending", as: latest.kind };
  if (latest.status === "rejected") return { kind: "application-rejected" };

  // Approved, but profile.role hasn't caught up yet (HQ approved the
  // application row without also promoting the profile). The database would
  // refuse this account's kitchen save / delivery accept, so wait here.
  if (latest.status === "approved") return { kind: "approval-finishing", as: latest.kind };

  return { kind: "apply" };
}

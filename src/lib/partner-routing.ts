import type { Profile, CookApplication, RiderApplication, PickerApplication } from "./types-auth";
import type { Kitchen, MerchantCategory } from "./types-kitchen";
import { categoryForBusinessType } from "./kitchen-profile";

/**
 * Everything the signed-in home route (`/`) needs to decide which screen to
 * show. Kept as plain data so the decision below is a pure function that can
 * be checked without a database.
 */
export interface PartnerRoutingInput {
  profile: Profile | null;
  cookApp: CookApplication | null;
  riderApp: RiderApplication | null;
  pickerApp: PickerApplication | null;
  kitchen: Kitchen | null;
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
  | { kind: "application-pending" }
  | { kind: "application-rejected" }
  | { kind: "kitchen-setup"; defaults: KitchenDefaults }
  | { kind: "partner-shell"; view: "cook" | "rider" }
  | { kind: "picker-shell" };

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
  pickerApp,
  kitchen,
}: PartnerRoutingInput): PartnerScreen {
  // Approved and active partner — show the real cook/rider/picker shell.
  if (profile && (profile.role === "cook" || profile.role === "rider" || profile.role === "picker")) {
    if (!profile.is_active) return { kind: "blocked" };

    if (profile.role === "rider") return { kind: "partner-shell", view: "rider" };
    if (profile.role === "picker") return { kind: "picker-shell" };

    // Cook: a saved kitchen means setup is done; otherwise setup needs the
    // cook application it was seeded from.
    if (kitchen) return { kind: "partner-shell", view: "cook" };
    if (cookApp) return kitchenSetupFor(cookApp);
    // Role says cook but there's no cook application — stale state, so
    // don't trust the role; fall through to the application check.
  }

  // Not (validly) a partner yet — route by the most recent application.
  const applications = [
    cookApp && { kind: "cook" as const, status: cookApp.status, created_at: cookApp.created_at },
    riderApp && { kind: "rider" as const, status: riderApp.status, created_at: riderApp.created_at },
    pickerApp && { kind: "picker" as const, status: pickerApp.status, created_at: pickerApp.created_at },
  ]
    .filter((a) => !!a)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const latest = applications[0];

  // No application of any kind: always the join/apply screen.
  if (!latest) return { kind: "apply" };

  if (latest.status === "pending") return { kind: "application-pending" };
  if (latest.status === "rejected") return { kind: "application-rejected" };

  // Approved, but profile.role hasn't caught up yet (e.g. HQ approved the
  // application row without also promoting the profile) — route straight
  // into the real partner flow instead of back through the sign-up form.
  if (latest.status === "approved") {
    if (latest.kind === "cook" && cookApp) {
      // Same "already set up?" check as the cook branch above — without it,
      // an approved cook whose role hasn't been promoted yet gets sent back
      // to Kitchen Setup forever, even after saving a kitchen.
      return kitchen ? { kind: "partner-shell", view: "cook" } : kitchenSetupFor(cookApp);
    }
    if (latest.kind === "rider") return { kind: "partner-shell", view: "rider" };
    if (latest.kind === "picker") return { kind: "picker-shell" };
  }

  return { kind: "apply" };
}

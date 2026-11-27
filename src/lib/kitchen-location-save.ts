import type { GeocodeResult } from "./geocode.ts";

/**
 * What Kitchen Setup's save does with the kitchen's location. Kept free of
 * React/Next.js (and of the server-only lookup itself) so it can be tested.
 *
 * - Postal code unchanged and coordinates already saved: OneMap isn't called.
 * - Lookup worked: the new coordinates are saved.
 * - Lookup unavailable (OneMap down, token rejected, timeout): everything
 *   else still saves; latitude/longitude are left out of the write, so any
 *   coordinates already saved stay and none are made up. The owner sees
 *   LOCATION_UNCONFIRMED_NOTICE.
 * - Postal code not 6 digits, not found, or the session expired: those the
 *   owner can fix, so the save stops with the message, as before.
 */

export const LOCATION_UNCONFIRMED_NOTICE =
  "We couldn't confirm your address location right now. Your details are saved; delivery quotes may be unavailable until it's confirmed.";

export type KitchenPostalLookup = GeocodeResult | { ok: false; reason: "signed_out" };

export type SavedLocation = { postal_code: string; latitude: number | null; longitude: number | null };

export type LocationPlan =
  /** Stop: show `error`, write nothing. */
  | { kind: "block"; error: string }
  /** Save; `coords` are written with the address, or left out (null) to keep what's saved. */
  | { kind: "save"; coords: { latitude: number; longitude: number } | null; foundAddress: string | null; unconfirmed: boolean };

export function postalLookupError(result: KitchenPostalLookup): string | null {
  if (result.ok) return null;
  switch (result.reason) {
    case "invalid":
      return "Postal code must be 6 digits (e.g. 310123).";
    case "not_found":
      return "We couldn't find that postal code. Please check it.";
    case "unavailable":
      return "Postal code lookup is temporarily unavailable. Please try again in a minute.";
    case "signed_out":
      return "Your session has expired. Please sign in again.";
  }
}

/** True when the save can skip OneMap: same postal code, coordinates already saved. */
export function canReuseSavedLocation(postal: string, saved: SavedLocation): boolean {
  return (
    postal.trim() === saved.postal_code.trim() &&
    typeof saved.latitude === "number" &&
    Number.isFinite(saved.latitude) &&
    typeof saved.longitude === "number" &&
    Number.isFinite(saved.longitude)
  );
}

export async function planKitchenLocation(
  postal: string,
  saved: SavedLocation,
  lookup: (postal: string) => Promise<KitchenPostalLookup>,
): Promise<LocationPlan> {
  const code = postal.trim();
  if (canReuseSavedLocation(code, saved)) {
    // Both checked by canReuseSavedLocation.
    return { kind: "save", coords: { latitude: saved.latitude!, longitude: saved.longitude! }, foundAddress: null, unconfirmed: false };
  }

  let result: KitchenPostalLookup;
  try {
    result = await lookup(code);
  } catch (e) {
    // The server action itself failed (network, deploy in progress).
    console.error("KitchenSetupForm: postal lookup threw", e);
    result = { ok: false, reason: "unavailable" };
  }

  if (result.ok) {
    return { kind: "save", coords: { latitude: result.lat, longitude: result.lng }, foundAddress: result.address, unconfirmed: false };
  }
  if (result.reason === "unavailable") {
    return { kind: "save", coords: null, foundAddress: null, unconfirmed: true };
  }
  return { kind: "block", error: postalLookupError(result)! };
}

/** The kitchen_addresses row: latitude/longitude only when there's a position to write. */
export function kitchenAddressRow(kitchenId: string, businessAddress: string, postal: string, plan: Extract<LocationPlan, { kind: "save" }>) {
  return {
    kitchen_id: kitchenId,
    business_address: businessAddress.trim(),
    postal_code: postal.trim(),
    ...(plan.coords ? { latitude: plan.coords.latitude, longitude: plan.coords.longitude } : {}),
  };
}

/** The note after a save that stays on the page; both reasons can apply at once. */
export function savedNotice(parts: { uenNote: string | null; locationUnconfirmed: boolean }): string | null {
  const lines = [parts.uenNote, parts.locationUnconfirmed ? LOCATION_UNCONFIRMED_NOTICE : null].filter(Boolean);
  return lines.length ? lines.join(" ") : null;
}

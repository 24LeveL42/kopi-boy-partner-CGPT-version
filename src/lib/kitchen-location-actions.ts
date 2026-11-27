"use server";

import { createClient } from "@/lib/supabase/server";
import { geocodePostalCode } from "@/lib/geocode";
import type { KitchenPostalLookup } from "@/lib/kitchen-location-save";

/**
 * Geocodes the kitchen's postal code on the server (OneMap). Called by
 * KitchenSetupForm's "Check postal code" button and on save when the postal
 * code changed or no coordinates are saved yet — the
 * kitchen's position comes only from this, never from the cook's device GPS.
 */
export async function lookupKitchenPostalCode(postalCode: string): Promise<KitchenPostalLookup> {
  // Server Actions are reachable by direct POST, so don't act as an open
  // geocoding proxy for anyone who isn't signed in.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, reason: "signed_out" };

  return geocodePostalCode(String(postalCode ?? ""));
}

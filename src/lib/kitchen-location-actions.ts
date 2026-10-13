"use server";

import { createClient } from "@/lib/supabase/server";
import { geocodePostalCode, type GeocodeResult } from "@/lib/geocode";

export type KitchenPostalLookup = GeocodeResult | { ok: false; reason: "signed_out" };

/**
 * Geocodes the kitchen's postal code on the server (OneMap). Called by
 * KitchenSetupForm's "Check postal code" button and again on save — the
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

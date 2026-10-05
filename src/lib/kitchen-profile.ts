import type { MerchantCategory } from "./types-kitchen";

// Must stay in sync with docs/supabase-schema.sql sections 28–33 (the
// kitchens_category_check / *_postal_code_check constraints, the private
// kitchen_addresses table, the derived public location and the
// acknowledged_terms_at trigger).

/**
 * The five business types, in display order. `label` is what the cook sees
 * and what cook_applications.business_type stores (section 26's UEN trigger
 * compares against 'Home Cook'); `id` is the kitchens.category slug.
 */
export const MERCHANT_CATEGORIES: { id: MerchantCategory; label: string }[] = [
  { id: "home-cook", label: "Home Cook" },
  { id: "hawker", label: "Hawker" },
  { id: "bakery", label: "Bakery" },
  { id: "vegetarian", label: "Vegetarian" },
  { id: "drinks-desserts", label: "Drinks & Desserts" },
];

/** Kitchen category for an application's business type label; older labels (e.g. "Small Business") fall back to Home Cook. */
export function categoryForBusinessType(businessType: string | null): MerchantCategory {
  return MERCHANT_CATEGORIES.find((c) => c.label === businessType)?.id ?? "home-cook";
}

export function isValidPostalCode(raw: string): boolean {
  return /^\d{6}$/.test(raw.trim());
}

/**
 * A kitchen's exact location — a kitchen_addresses row. Only the owning cook
 * can read it directly; the rider/picker currently assigned to a request there
 * gets it from get_delivery_kitchen_location / get_pickup_kitchen_location
 * (schema sections 28 and 30). Everyone else only sees the coarse public
 * values on kitchens: postal_sector and rounded latitude/longitude (section 29).
 */
export interface KitchenLocation {
  business_address: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** What anyone may see: "Postal sector 31". */
export function publicKitchenArea(postalSector: string | null | undefined): string {
  return postalSector ? `Postal sector ${postalSector}` : "";
}

/** "Blk 123 Toa Payoh Lor 1, #01-23, Singapore 310123" — whichever parts exist. */
export function formatKitchenAddress(loc: KitchenLocation): string {
  return [loc.business_address, loc.postal_code && `Singapore ${loc.postal_code}`].filter(Boolean).join(", ");
}

/** Google Maps link to the exact spot, falling back to the address text. */
export function kitchenMapsUrl(loc: KitchenLocation): string | null {
  const query = loc.latitude != null && loc.longitude != null ? `${loc.latitude},${loc.longitude}` : formatKitchenAddress(loc);
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

export const KITCHEN_TERMS =
  "I acknowledge that Kopi Boy only connects customers with cooks. I am responsible for food safety, hygiene, pricing, and fulfilling orders I accept. Kopi Boy does not process payments or guarantee income.";

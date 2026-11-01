/**
 * Kitchen + menu item types — Feature #003.
 *
 * Mirrors the `kitchens` / `menu_items` tables added to
 * `docs/supabase-schema.sql`. `category` / `cuisine_type` values match the
 * Customer app's `MerchantCategory` / `CuisineType` exactly — a kitchen row
 * is rendered directly as a `Merchant` there (see that repo's
 * `src/lib/kitchens.ts`).
 */

export type MerchantCategory = "home-cook" | "hawker" | "bakery" | "vegetarian" | "drinks-desserts";
export type CuisineType = "chinese" | "halal" | "indian" | "western";
export type PaynowType = "mobile" | "uen";

export interface Kitchen {
  id: string;
  business_name: string;
  category: MerchantCategory;
  cuisine_type: CuisineType;
  /**
   * Public, and derived by the database (schema section 29) from the private
   * kitchen_addresses row — never written by the app. The full postal code,
   * street address and exact coordinates live only in kitchen_addresses.
   */
  postal_sector: string | null;
  is_halal: boolean;
  description: string | null;
  hero_image: string | null;
  is_live: boolean;
  /** Set only by the database from the approved cook application (schema section 27) — never written by the app. */
  business_uen: string | null;
}

/**
 * The owner-only part of a kitchens row the Partner app uses (kitchen privacy
 * Phase 2): read through get_my_kitchen_private(), never by selecting the
 * columns as a signed-in user (src/lib/kitchen-private.ts). kitchens.latitude
 * and longitude are private too, but the cook's form reads its exact location
 * from kitchen_addresses instead.
 */
export interface KitchenPrivate {
  paynow_type: PaynowType | null;
  paynow_value: string | null;
  /** Stamped by the database (schema section 33) the first time the cook ticks the partner terms; null on kitchens that predate it. */
  acknowledged_terms_at: string | null;
}

export interface MenuItem {
  id: string;
  kitchen_id: string;
  name: string;
  price: number;
  photo_url: string | null;
}

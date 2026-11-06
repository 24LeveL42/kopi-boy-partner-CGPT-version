import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Regions (docs/supabase-regions.sql). Riders pick where they usually ride;
 * the only write is the set_my_ride_regions RPC, and a rider reads only their
 * own rider_regions rows. No home address or postal code is ever asked for or
 * stored for a rider. A cook's region is derived by the database from their
 * private postal code (kitchens.region) and is only ever shown, never sent.
 *
 * Kept free of Next.js imports so it can be tested with a fake client.
 */

export type RegionCode = "north" | "south" | "east" | "west";

/** The fixed order and labels, the same as public.regions (sort_order 1-4). */
export const REGIONS: readonly { code: RegionCode; label: string }[] = [
  { code: "north", label: "North" },
  { code: "south", label: "South" },
  { code: "east", label: "East" },
  { code: "west", label: "West" },
];

export const PICK_A_REGION_MESSAGE = "Pick at least one region you ride in.";

export function isRegionCode(value: unknown): value is RegionCode {
  return REGIONS.some((r) => r.code === value);
}

export function regionLabel(code: string | null | undefined): string | null {
  return REGIONS.find((r) => r.code === code)?.label ?? null;
}

/** Known codes only, no duplicates, in the fixed order. */
export function normalizeRegions(values: readonly unknown[]): RegionCode[] {
  const picked = new Set(values.map((v) => (typeof v === "string" ? v.trim().toLowerCase() : v)));
  return REGIONS.map((r) => r.code).filter((code) => picked.has(code));
}

/** The client-side check; the database checks again. */
export function validateRideRegions(values: readonly unknown[]): { ok: true; regions: RegionCode[] } | { ok: false; message: string } {
  const regions = normalizeRegions(values);
  return regions.length > 0 ? { ok: true, regions } : { ok: false, message: PICK_A_REGION_MESSAGE };
}

export function sameRegions(a: readonly string[], b: readonly string[]): boolean {
  const x = normalizeRegions(a);
  const y = normalizeRegions(b);
  return x.length === y.length && x.every((c, i) => c === y[i]);
}

type ErrorLike = { code?: string; message?: string } | null | undefined;

export type RideRegionsLoad =
  /** Loaded: the rider's regions (possibly none yet). */
  | { ok: true; regions: RegionCode[] }
  /** Couldn't be read: callers neither prompt nor pre-fill. */
  | { ok: false };

/** The signed-in rider's own regions, read from rider_regions (RLS: own rows only). */
export async function loadMyRideRegions(client: Pick<SupabaseClient, "from">, userId: string): Promise<RideRegionsLoad> {
  try {
    const { data, error } = await client.from("rider_regions").select("region").eq("user_id", userId);
    if (error) return { ok: false };
    return { ok: true, regions: normalizeRegions(((data ?? []) as { region: unknown }[]).map((r) => r.region)) };
  } catch {
    return { ok: false };
  }
}

/** Show the gentle "choose your regions" prompt? Only when we know none are saved, never on a failed read. */
export function shouldPromptForRideRegions(load: RideRegionsLoad | null): boolean {
  return !!load && load.ok && load.regions.length === 0;
}

/** A message a rider can act on, for an error from set_my_ride_regions. */
export function rideRegionsSaveMessage(error: ErrorLike): string {
  const message = error?.message ?? "";
  if (/at least one region/i.test(message)) return PICK_A_REGION_MESSAGE;
  if (/unknown region/i.test(message)) return "That region isn't one of North, South, East or West. Please pick again.";
  if (/sign in first/i.test(message)) return "Your session has ended. Please sign in again, then save your regions.";
  if (/only riders and rider applicants/i.test(message)) return "Only riders and rider applicants can choose ride regions.";
  if (error?.code === "PGRST202" || error?.code === "42883") return "Choosing regions isn't available yet. Please try again later.";
  return "Couldn't save your regions. Please check your connection and try again.";
}

/**
 * Replaces the signed-in rider's regions with exactly `values`, in one step,
 * through set_my_ride_regions. Returns null on success, or a message to show.
 */
export async function saveMyRideRegions(client: Pick<SupabaseClient, "rpc">, values: readonly unknown[]): Promise<string | null> {
  const checked = validateRideRegions(values);
  if (!checked.ok) return checked.message;
  try {
    const { error } = await client.rpc("set_my_ride_regions", { p_regions: checked.regions });
    if (!error) return null;
    console.error("set_my_ride_regions failed:", error);
    return rideRegionsSaveMessage(error);
  } catch (e) {
    console.error("set_my_ride_regions failed:", e);
    return rideRegionsSaveMessage(null);
  }
}

/**
 * The cook's region, derived by the database from their postal code. A read of
 * its own, never part of the kitchen's main query: if the column is missing
 * (42703) or not granted (42501) only this label goes, never the page.
 */
export async function loadKitchenRegion(client: Pick<SupabaseClient, "from">, kitchenId: string): Promise<RegionCode | null> {
  try {
    const { data, error } = await client.from("kitchens").select("region").eq("id", kitchenId).maybeSingle<{ region: unknown }>();
    if (error || !data) return null;
    return isRegionCode(data.region) ? data.region : null;
  } catch {
    return null;
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { KitchenPrivate } from "./types-kitchen";

/**
 * Kitchen privacy Phase 2 (docs/supabase-kitchen-privacy-phase2.sql): signed-in
 * users can only read the public kitchens columns. PayNow, coordinates and the
 * terms date come only through get_my_kitchen_private() (the owning cook) or
 * admin_get_kitchen_private() (admins). Kept free of Next.js imports so it can
 * be tested with a fake client.
 *
 * Never select("*") on kitchens: once the lock is on, "*" includes columns the
 * caller can't read and the whole query fails (src/lib/kitchen-private.test.ts
 * scans the source for it).
 */

/** The 5 columns only the owner and admins can read. */
export const KITCHEN_PRIVATE_COLUMNS = ["paynow_type", "paynow_value", "latitude", "longitude", "acknowledged_terms_at"] as const;

/** The public kitchens columns the Partner app reads (all in Phase 1's granted list of 15). */
export const KITCHEN_COLUMNS = "id, business_name, category, cuisine_type, postal_sector, is_halal, description, hero_image, is_live, business_uen";

/** What the cook's own form needs of the private columns. */
const OWN_PRIVATE_COLUMNS = "paynow_type, paynow_value, acknowledged_terms_at";

type ErrorLike = { code?: string; message: string } | null;
type PrivateClient = Pick<SupabaseClient, "rpc" | "from">;

/** "The function doesn't exist yet" — Part A of the SQL hasn't run (PostgREST / Postgres codes). */
export function isMissingFunction(error: ErrorLike): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

export type KitchenPrivateLoad =
  /** Loaded; null = no kitchen saved yet. */
  | { ok: true; data: KitchenPrivate | null }
  /** Couldn't be read: the form shows empty fields and must not overwrite PayNow. */
  | { ok: false };

/**
 * The signed-in cook's PayNow and terms date. Uses get_my_kitchen_private();
 * before Part A has run (function missing) it reads the 3 columns directly,
 * as the app did before. Any other error is { ok: false }.
 */
export async function loadMyKitchenPrivate(client: PrivateClient, kitchenId: string): Promise<KitchenPrivateLoad> {
  try {
    const { data, error } = await client.rpc("get_my_kitchen_private");
    if (!error) {
      // A set-returning function comes back as an array.
      const row = (Array.isArray(data) ? data[0] : data) as KitchenPrivate | undefined;
      return { ok: true, data: row ? pickPrivate(row) : null };
    }
    if (!isMissingFunction(error)) return { ok: false };

    const old = await client.from("kitchens").select(OWN_PRIVATE_COLUMNS).eq("id", kitchenId).maybeSingle<KitchenPrivate>();
    if (old.error) return { ok: false };
    return { ok: true, data: old.data ? pickPrivate(old.data) : null };
  } catch {
    return { ok: false };
  }
}

function pickPrivate(row: KitchenPrivate): KitchenPrivate {
  return {
    paynow_type: row.paynow_type ?? null,
    paynow_value: row.paynow_value ?? null,
    acknowledged_terms_at: row.acknowledged_terms_at ?? null,
  };
}

type SaveClient = Pick<SupabaseClient, "from">;

/**
 * Saves the cook's kitchens row without upsert: an upsert (INSERT ... ON
 * CONFLICT DO UPDATE SET col = EXCLUDED.col) needs SELECT on every column it
 * sets, which signed-in users no longer have on the private ones. A plain
 * INSERT (first save) or UPDATE (after that) only needs INSERT / UPDATE.
 * Nothing is returned, so no private column is read back.
 *
 * `existed` is what the page loaded; if an INSERT finds the row already there
 * (a second tab, a double tap), it's retried as an UPDATE.
 */
export async function saveKitchenRow(
  client: SaveClient,
  kitchenId: string,
  existed: boolean,
  row: Record<string, unknown>
): Promise<{ error: ErrorLike }> {
  if (!existed) {
    const { error } = await client.from("kitchens").insert({ ...row, id: kitchenId });
    if (!error) return { error: null };
    if (error.code !== "23505") return { error };
  }
  const { error } = await client.from("kitchens").update(row).eq("id", kitchenId);
  return { error: error ?? null };
}

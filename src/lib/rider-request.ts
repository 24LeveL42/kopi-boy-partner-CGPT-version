import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * When a cook may request a rider, and the request itself, run on the server
 * (see cook-order-actions.ts) with the cook's own session, so RLS still
 * applies. Kept free of Next.js imports so it can be tested with a fake client.
 *
 * A scheduled order can only get a rider from RIDER_REQUEST_LEAD_MINUTES
 * before its scheduled time: the request is what pings every on-duty rider
 * (notify_on_delivery_change), so asking earlier would ping them hours early.
 * ASAP orders (scheduled_for null) can request a rider any time, as before.
 * The database enforces the same rule (guard_scheduled_delivery_request in
 * docs/supabase-rider-request-window.sql) — keep the two in sync.
 */

export const RIDER_REQUEST_LEAD_MINUTES = 45;

/** When a rider can first be requested, or null for an ASAP order. */
export function riderRequestOpensAt(scheduledFor: string | null | undefined): Date | null {
  if (!scheduledFor?.trim()) return null;
  const scheduled = new Date(scheduledFor).getTime();
  if (Number.isNaN(scheduled)) return null;
  return new Date(scheduled - RIDER_REQUEST_LEAD_MINUTES * 60_000);
}

export function canRequestRiderAt(scheduledFor: string | null | undefined, now: number): boolean {
  const opensAt = riderRequestOpensAt(scheduledFor);
  return !opensAt || now >= opensAt.getTime();
}

/** "5:30 pm" — Singapore time, whatever the device's zone. */
function singaporeTime(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", hour: "numeric", minute: "2-digit", hour12: true })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return `${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toLowerCase()}`;
}

/** "Rider can be requested from 5:30 pm" — Singapore time, whatever the device's zone. */
export function riderRequestOpensLabel(scheduledFor: string | null | undefined): string {
  const opensAt = riderRequestOpensAt(scheduledFor);
  return opensAt ? `Rider can be requested from ${singaporeTime(opensAt)}` : "";
}

/** "Rider from 5:30 pm" — short enough for a half-width button on a phone. */
export function riderRequestOpensShortLabel(scheduledFor: string | null | undefined): string {
  const opensAt = riderRequestOpensAt(scheduledFor);
  return opensAt ? `Rider from ${singaporeTime(opensAt)}` : "";
}

export type RequestRiderResult = { ok: true } | { ok: false; error: string };

type RequestClient = Pick<SupabaseClient, "from">;

/**
 * Requests a rider for one of the cook's orders. `now` is the server's clock
 * (never the browser's); the database checks again against its own.
 */
export async function requestRiderAs(
  client: RequestClient,
  kitchenId: string,
  orderId: string,
  now: number
): Promise<RequestRiderResult> {
  try {
    if (!orderId) return { ok: false, error: "This order is missing." };

    // "*" rather than naming scheduled_for, so a database without that column yet still works (as ASAP).
    const { data: order, error: orderError } = await client
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .eq("kitchen_id", kitchenId)
      .maybeSingle<{ scheduled_for?: string | null }>();
    if (orderError) return { ok: false, error: "Couldn't check this order. Please try again." };
    if (!order) return { ok: false, error: "This order isn't at your kitchen." };

    if (!canRequestRiderAt(order.scheduled_for, now)) {
      return { ok: false, error: `${riderRequestOpensLabel(order.scheduled_for)}.` };
    }

    const { error } = await client.from("delivery_requests").insert({ order_id: orderId, kitchen_id: kitchenId });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

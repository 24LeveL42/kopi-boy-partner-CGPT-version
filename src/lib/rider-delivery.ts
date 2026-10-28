import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The rider's delivery writes, run on the server (see rider-delivery-actions.ts)
 * with the rider's own session, so RLS still applies. Kept free of Next.js
 * imports so it can be tested with a fake client.
 *
 * Every function returns a result object and never throws. A blocked rider
 * gets BLOCKED_ACCOUNT_MESSAGE — checked here first, and again by the
 * database (guard_blocked_rider_delivery_update in
 * docs/supabase-admin-messages.sql) in case the block lands mid-request.
 */

export const BLOCKED_ACCOUNT_MESSAGE = "Your account is blocked.";

export type RiderActionResult = { ok: true } | { ok: false; error: string; blocked?: true };

type DeliveryClient = Pick<SupabaseClient, "from" | "rpc">;

const BLOCKED: RiderActionResult = { ok: false, error: BLOCKED_ACCOUNT_MESSAGE, blocked: true };
const UNEXPECTED: RiderActionResult = { ok: false, error: "Something went wrong. Please try again." };

async function checkActiveRider(client: DeliveryClient, userId: string): Promise<RiderActionResult> {
  const { data, error } = await client
    .from("profiles")
    .select("role, is_active")
    .eq("id", userId)
    .maybeSingle<{ role: string; is_active: boolean }>();
  if (error) return { ok: false, error: "Couldn't check your account. Please try again." };
  if (!data || data.role !== "rider") return { ok: false, error: "Only riders can do this." };
  if (!data.is_active) return BLOCKED;
  return { ok: true };
}

function fromDbError(error: { message: string }): RiderActionResult {
  return error.message === BLOCKED_ACCOUNT_MESSAGE ? BLOCKED : { ok: false, error: error.message };
}

export const ALREADY_COLLECTED_MESSAGE = "You've already marked this food as collected.";
export const COLLECT_FIRST_MESSAGE = "Collect the food first, then mark it delivered.";
const NOT_ACTIVE: RiderActionResult = { ok: false, error: "This delivery is no longer active." };

type DeliveryRow = { rider_id: string | null; status: string; picked_up_at?: string | null };

/**
 * Accepted -> picked up -> delivered. picked_up_at is undefined (not null)
 * when the database doesn't have the column yet
 * (docs/supabase-delivery-pickup.sql not run): then there's no pickup step and
 * delivering works as before, so no rider gets stuck mid-job.
 */
export function isCollected(delivery: { picked_up_at?: string | null }): boolean {
  return delivery.picked_up_at !== null;
}

// The rider's own accepted delivery, read with their session (RLS: assigned rows only).
async function loadOwnActiveDelivery(
  client: DeliveryClient,
  userId: string,
  requestId: string
): Promise<{ ok: true; delivery: DeliveryRow } | { ok: false; result: RiderActionResult }> {
  const { data, error } = await client
    .from("delivery_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle<DeliveryRow>();
  if (error) return { ok: false, result: { ok: false, error: "Couldn't check this delivery. Please try again." } };
  if (!data || data.rider_id !== userId || data.status !== "accepted") return { ok: false, result: NOT_ACTIVE };
  return { ok: true, delivery: data };
}

export async function acceptDeliveryAs(
  client: DeliveryClient,
  userId: string,
  requestId: string
): Promise<RiderActionResult> {
  try {
    if (!requestId) return { ok: false, error: "This delivery request is missing." };
    const gate = await checkActiveRider(client, userId);
    if (!gate.ok) return gate;

    const { error } = await client
      .from("delivery_requests")
      .update({ rider_id: userId, status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", requestId)
      .eq("status", "open"); // first to accept wins — a second rider's update matches 0 rows
    return error ? fromDbError(error) : { ok: true };
  } catch {
    return UNEXPECTED;
  }
}

/**
 * "I've collected the food". The database stamps picked_up_at with its own
 * clock and re-checks everything (mark_delivery_picked_up in
 * docs/supabase-delivery-pickup.sql), including that the order isn't
 * cancelled, which the rider can't read from here.
 */
export async function markCollectedAs(
  client: DeliveryClient,
  userId: string,
  requestId: string
): Promise<RiderActionResult> {
  try {
    if (!requestId) return { ok: false, error: "This delivery request is missing." };
    const gate = await checkActiveRider(client, userId);
    if (!gate.ok) return gate;

    const own = await loadOwnActiveDelivery(client, userId, requestId);
    if (!own.ok) return own.result;
    if (own.delivery.picked_up_at) return { ok: false, error: ALREADY_COLLECTED_MESSAGE };

    const { error } = await client.rpc("mark_delivery_picked_up", { p_request_id: requestId });
    return error ? fromDbError(error) : { ok: true };
  } catch {
    return UNEXPECTED;
  }
}

/**
 * Completes the delivery. The photo is optional: when the rider attached one
 * (already uploaded), it's posted to the customer in the same transaction;
 * with none, the delivery is just completed
 * (docs/supabase-optional-delivery-photo.sql).
 */
export async function completeDeliveryAs(
  client: DeliveryClient,
  userId: string,
  requestId: string,
  photoPath: string | null
): Promise<RiderActionResult> {
  try {
    if (!requestId) return { ok: false, error: "This delivery request is missing." };
    const gate = await checkActiveRider(client, userId);
    if (!gate.ok) return gate;

    const own = await loadOwnActiveDelivery(client, userId, requestId);
    if (!own.ok) return own.result;
    if (!isCollected(own.delivery)) return { ok: false, error: COLLECT_FIRST_MESSAGE };

    const { error } = await client.rpc("complete_delivery_with_proof", {
      p_request_id: requestId,
      p_photo_path: photoPath || null,
    });
    return error ? fromDbError(error) : { ok: true };
  } catch {
    return UNEXPECTED;
  }
}

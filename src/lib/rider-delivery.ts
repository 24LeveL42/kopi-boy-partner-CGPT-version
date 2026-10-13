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

/** Posts the proof photo (already uploaded by the rider) and completes the delivery in one transaction. */
export async function completeDeliveryAs(
  client: DeliveryClient,
  userId: string,
  requestId: string,
  photoPath: string
): Promise<RiderActionResult> {
  try {
    if (!requestId) return { ok: false, error: "This delivery request is missing." };
    const gate = await checkActiveRider(client, userId);
    if (!gate.ok) return gate;

    const { error } = await client.rpc("complete_delivery_with_proof", {
      p_request_id: requestId,
      p_photo_path: photoPath,
    });
    return error ? fromDbError(error) : { ok: true };
  } catch {
    return UNEXPECTED;
  }
}

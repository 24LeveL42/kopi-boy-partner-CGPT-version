import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Past orders on the cook's order screen and the rider's jobs screen: which
 * ones are finished, their order in the "Past orders" list, and "Remove from
 * my list". Kept free of Next.js imports so it can be tested with a fake client.
 *
 * Removing only hides a row for that cook or rider (orders.cook_hidden_at,
 * delivery_requests.rider_hidden_at — docs/supabase-hide-past-orders.sql).
 * Nothing is deleted, and nothing else filters on those columns, so counts,
 * earnings and every other app still see hidden orders. The database
 * re-checks role, block, ownership and "finished" in its own functions;
 * the checks here are for a clean message first. Keep the two "finished"
 * definitions in sync.
 */

export const PAST_ORDERS_PAGE_SIZE = 10;

type OrderLike = {
  order_status: string;
  payment_status: string;
  decided_at?: string | null;
  created_at: string;
  delivery_requests?: { status: string; completed_at?: string | null }[] | null;
};

type JobLike = { status: string; completed_at?: string | null; accepted_at?: string | null; created_at: string };

function completedDelivery(order: OrderLike) {
  return (order.delivery_requests ?? []).find((r) => r.status === "completed");
}

/**
 * Cancelled, rejected, or delivered AND paid. A delivered order the cook
 * hasn't marked paid still needs the "Payment received" button, so it stays active.
 */
export function isCookOrderFinished(order: OrderLike): boolean {
  if (order.order_status === "cancelled" || order.order_status === "rejected") return true;
  return order.order_status === "accepted" && order.payment_status === "paid" && Boolean(completedDelivery(order));
}

export function isRiderJobFinished(job: { status: string }): boolean {
  return job.status === "completed" || job.status === "cancelled";
}

export function cookOrderOutcome(order: OrderLike): "Delivered" | "Cancelled" | "Rejected" {
  return order.order_status === "cancelled" ? "Cancelled" : order.order_status === "rejected" ? "Rejected" : "Delivered";
}

export function riderJobOutcome(job: { status: string }): "Delivered" | "Cancelled" {
  return job.status === "completed" ? "Delivered" : "Cancelled";
}

/** When it finished, as best the row knows — delivered time, decision time, else when it was placed. */
export function cookOrderFinishedAt(order: OrderLike): string {
  return completedDelivery(order)?.completed_at || (order.order_status === "rejected" && order.decided_at) || order.created_at;
}

export function riderJobFinishedAt(job: JobLike): string {
  return job.completed_at || job.accepted_at || job.created_at;
}

/** Newest first. Doesn't mutate the input. */
export function newestFirst<T>(items: T[], finishedAt: (item: T) => string): T[] {
  return [...items].sort((a, b) => new Date(finishedAt(b)).getTime() - new Date(finishedAt(a)).getTime());
}

/** "19 Oct, 6:12 pm", Singapore time whatever the device's zone. */
export function formatFinishedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Singapore",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return `${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toLowerCase()}`;
}

/**
 * True when a list query failed only because the hidden column doesn't exist
 * yet (the SQL hasn't been run). The screen then loads without the filter, as before.
 */
export function isMissingHiddenColumn(error: { message: string } | null, column: string): boolean {
  return Boolean(error?.message.includes(column));
}

// ---------------------------------------------------------------------------
// "Remove from my list"
// ---------------------------------------------------------------------------

export const BLOCKED_ACCOUNT_MESSAGE = "Your account is blocked.";
export const COOK_NOT_FINISHED_MESSAGE = "Only finished orders can be removed from your list.";
export const RIDER_NOT_FINISHED_MESSAGE = "Only finished jobs can be removed from your list.";
export const NOT_SET_UP_MESSAGE = "Removing orders isn't switched on yet. Please message Kopi Boy.";

export type HideResult = { ok: true } | { ok: false; error: string; blocked?: true };

type HideClient = Pick<SupabaseClient, "from" | "rpc">;
type DbError = { code?: string; message: string };

const BLOCKED: HideResult = { ok: false, error: BLOCKED_ACCOUNT_MESSAGE, blocked: true };
const UNEXPECTED: HideResult = { ok: false, error: "Something went wrong. Please try again." };

async function checkActivePartner(client: HideClient, userId: string, role: "cook" | "rider"): Promise<HideResult> {
  const { data, error } = await client
    .from("profiles")
    .select("role, is_active")
    .eq("id", userId)
    .maybeSingle<{ role: string; is_active: boolean }>();
  if (error) return { ok: false, error: "Couldn't check your account. Please try again." };
  if (!data || data.role !== role) return { ok: false, error: role === "cook" ? "Only cooks can do this." : "Only riders can do this." };
  if (!data.is_active) return BLOCKED;
  return { ok: true };
}

function fromDbError(error: DbError): HideResult {
  if (error.message === BLOCKED_ACCOUNT_MESSAGE) return BLOCKED;
  // PostgREST: function not found — docs/supabase-hide-past-orders.sql hasn't been run.
  if (error.code === "PGRST202") return { ok: false, error: NOT_SET_UP_MESSAGE };
  return { ok: false, error: error.message };
}

async function callHide(client: HideClient, fn: string, args?: Record<string, string>): Promise<HideResult> {
  const { error } = await client.rpc(fn, args);
  return error ? fromDbError(error) : { ok: true };
}

/** One of the cook's own finished orders, read with their session (RLS: own kitchen only). */
export async function hideCookOrderAs(client: HideClient, userId: string, orderId: string): Promise<HideResult> {
  try {
    if (!orderId) return { ok: false, error: "This order is missing." };
    const gate = await checkActivePartner(client, userId, "cook");
    if (!gate.ok) return gate;

    const { data: order, error } = await client
      .from("orders")
      .select("order_status, payment_status, created_at, delivery_requests(status)")
      .eq("id", orderId)
      .eq("kitchen_id", userId)
      .maybeSingle<OrderLike>();
    if (error) return { ok: false, error: "Couldn't check this order. Please try again." };
    if (!order) return { ok: false, error: "This order isn't at your kitchen." };
    if (!isCookOrderFinished(order)) return { ok: false, error: COOK_NOT_FINISHED_MESSAGE };

    return await callHide(client, "hide_cook_order", { p_order_id: orderId });
  } catch {
    return UNEXPECTED;
  }
}

/** Every finished order at the cook's kitchen — the database picks them, not the browser. */
export async function hideAllCookOrdersAs(client: HideClient, userId: string): Promise<HideResult> {
  try {
    const gate = await checkActivePartner(client, userId, "cook");
    if (!gate.ok) return gate;
    return await callHide(client, "hide_all_cook_past_orders");
  } catch {
    return UNEXPECTED;
  }
}

/** One of the rider's own finished jobs, read with their session (RLS: assigned rows only). */
export async function hideRiderJobAs(client: HideClient, userId: string, requestId: string): Promise<HideResult> {
  try {
    if (!requestId) return { ok: false, error: "This job is missing." };
    const gate = await checkActivePartner(client, userId, "rider");
    if (!gate.ok) return gate;

    const { data: job, error } = await client
      .from("delivery_requests")
      .select("rider_id, status")
      .eq("id", requestId)
      .maybeSingle<{ rider_id: string | null; status: string }>();
    if (error) return { ok: false, error: "Couldn't check this job. Please try again." };
    if (!job || job.rider_id !== userId) return { ok: false, error: "This job isn't yours." };
    if (!isRiderJobFinished(job)) return { ok: false, error: RIDER_NOT_FINISHED_MESSAGE };

    return await callHide(client, "hide_rider_job", { p_request_id: requestId });
  } catch {
    return UNEXPECTED;
  }
}

export async function hideAllRiderJobsAs(client: HideClient, userId: string): Promise<HideResult> {
  try {
    const gate = await checkActivePartner(client, userId, "rider");
    if (!gate.ok) return gate;
    return await callHide(client, "hide_all_rider_past_jobs");
  } catch {
    return UNEXPECTED;
  }
}

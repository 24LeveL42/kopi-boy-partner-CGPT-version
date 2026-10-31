/**
 * The cook's one-card-per-order view: which stage the kitchen side is at and
 * what the rider side shows. Payment and rider state are read independently
 * so an older order that was delivered before it was marked paid still shows
 * both "Payment received" and "Delivered" on the same card. Kept free of
 * Next.js imports so it can be tested on its own.
 */

/** unpaid → (Payment received) → not_started → (Start Cooking) → preparing → (Mark Ready) → ready */
export type CookCardStage = "unpaid" | "not_started" | "preparing" | "ready";

/**
 * none      — no live request: show "Request rider" (once paid)
 * requested — open request, riders have been notified
 * accepted  — a rider accepted and is on the way
 * picked_up — the rider has collected the food
 * delivered — the delivery is completed
 * released  — the rider dropped it; the cook can request again
 */
export type RiderStage = "none" | "requested" | "accepted" | "picked_up" | "delivered" | "released";

type OrderLike = { payment_status: string; preparation_status: string };
type RequestLike = { status: string; created_at: string; picked_up_at?: string | null };

export function cookCardStage(order: OrderLike): CookCardStage {
  if (order.payment_status !== "paid") return "unpaid";
  if (order.preparation_status === "preparing" || order.preparation_status === "ready") return order.preparation_status;
  return "not_started";
}

function newest<T extends RequestLike>(requests: T[]): T | undefined {
  return [...requests].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
}

/** The rider side of the card, and the request it's about (for the rider panel, chat and map). */
export function riderView<T extends RequestLike>(requests: T[] | null | undefined): { stage: RiderStage; request?: T } {
  const all = requests ?? [];

  const completed = newest(all.filter((r) => r.status === "completed"));
  if (completed) return { stage: "delivered", request: completed };

  // A live request wins over an older dropped one (the cook already re-requested).
  const active = newest(all.filter((r) => r.status === "open" || r.status === "accepted"));
  if (active?.status === "open") return { stage: "requested", request: active };
  if (active) return { stage: active.picked_up_at ? "picked_up" : "accepted", request: active };

  const released = newest(all.filter((r) => r.status === "release_requested"));
  if (released) return { stage: "released", request: released };

  return { stage: "none" };
}

/** "Request rider" shows only once the cook has confirmed payment, and only when no rider is live. */
export function canShowRequestRider(cardStage: CookCardStage, riderStage: RiderStage): boolean {
  return cardStage !== "unpaid" && (riderStage === "none" || riderStage === "released");
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { usePendingAction } from "@/lib/use-pending-action";
import { PendingLabel } from "./Pending";
import { SkeletonCards } from "./Skeleton";
import type { OrderWithItems } from "@/lib/types-orders";
import type { DeliveryRequest, DeliveryRiderDetails } from "@/lib/types-delivery";
import { PartnerRiderChat } from "./PartnerRiderChat";

interface OrderWithDelivery extends OrderWithItems {
  delivery_requests: DeliveryRequest[];
}

// Cooks can't read the customer's profile (no RLS policy grants that), so
// order cards are identified by a short id + timestamp, not a customer name.
function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}

function itemsSummary(order: OrderWithItems) {
  return order.order_items.map((i) => `${i.quantity}x ${i.name}`).join(", ");
}

export function CookOrdersPanel({ kitchenId }: { kitchenId: string }) {
  const supabase = createClient();
  const [newOrders, setNewOrders] = useState<OrderWithItems[]>([]);
  const [awaitingPayment, setAwaitingPayment] = useState<OrderWithItems[]>([]);
  const [inKitchen, setInKitchen] = useState<OrderWithDelivery[]>([]);
  const [riderDetails, setRiderDetails] = useState<Record<string, DeliveryRiderDetails>>({});
  const [openChatId, setOpenChatId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { busy, isRunning, run } = usePendingAction();

  // `silent` = live refresh: update in place without flashing the loading state.
  const load = useCallback(async (silent?: boolean) => {
    if (silent !== true) setLoading(true);

    const { data, error: loadError } = await supabase
      .from("orders")
      .select("*, order_items(*), delivery_requests(*)")
      .eq("kitchen_id", kitchenId)
      .in("order_status", ["placed", "accepted"])
      .order("created_at", { ascending: true })
      .returns<OrderWithDelivery[]>();

    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }

    const rows = data ?? [];
    setNewOrders(rows.filter((o) => o.order_status === "placed"));
    setAwaitingPayment(rows.filter((o) => o.order_status === "accepted" && o.payment_status === "unpaid"));
    setInKitchen(rows.filter((o) => o.order_status === "accepted"));

    // Rider profile data is intentionally protected by RLS. The RPC exposes
    // only the minimum rider details to the cook who owns this delivery.
    const acceptedRequests = rows
      .flatMap((o) => o.delivery_requests ?? [])
      .filter((r) => r.status === "accepted");
    const detailPairs = await Promise.all(acceptedRequests.map(async (r) => {
      const { data: rider } = await supabase
        .rpc("get_delivery_rider", { p_delivery_request_id: r.id })
        .maybeSingle<DeliveryRiderDetails>();
      return [r.id, rider] as const;
    }));
    const nextDetails: Record<string, DeliveryRiderDetails> = {};
    for (const [requestId, rider] of detailPairs) {
      if (rider) nextDetails[requestId] = rider;
    }
    setRiderDetails(nextDetails);
    setLoading(false);
  }, [supabase, kitchenId]);

  useEffect(() => {
    // Deferred so the initial setLoading(true) inside load() doesn't run
    // synchronously as part of the effect's own commit.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  useLiveRefresh(
    [
      { table: "orders", filter: `kitchen_id=eq.${kitchenId}` },
      { table: "delivery_requests", filter: `kitchen_id=eq.${kitchenId}` },
    ],
    () => void load(true)
  );

  // Every order action is one guarded write, then a silent reload so the card
  // has moved on before its button re-enables.
  function act(key: string, write: () => PromiseLike<{ error: { message: string } | null }>) {
    run(key, async () => {
      setError(null);
      const { error: writeError } = await write();
      if (writeError) {
        setError(writeError.message);
        return;
      }
      await load(true);
    });
  }

  function decide(orderId: string, decision: "accepted" | "rejected") {
    act(`${orderId}:${decision}`, () =>
      supabase
        .from("orders")
        .update({ order_status: decision, decided_at: new Date().toISOString() })
        .eq("id", orderId)
        .eq("order_status", "placed") // can't decide an already-decided order
    );
  }

  function markPaid(orderId: string) {
    act(`${orderId}:paid`, () =>
      supabase
        .from("orders")
        .update({ payment_status: "paid", paid_at: new Date().toISOString() })
        .eq("id", orderId)
        .eq("order_status", "accepted")
        .eq("payment_status", "unpaid") // can't mark paid before accepted / twice
    );
  }

  function startCooking(orderId: string) {
    act(`${orderId}:cook`, () =>
      supabase
        .from("orders")
        .update({ preparation_status: "preparing" })
        .eq("id", orderId)
        .eq("order_status", "accepted")
        .eq("preparation_status", "not_started") // can't start cooking before accepted / twice
    );
  }

  function markReady(orderId: string) {
    act(`${orderId}:ready`, () =>
      supabase
        .from("orders")
        .update({ preparation_status: "ready", ready_at: new Date().toISOString() })
        .eq("id", orderId)
        .eq("order_status", "accepted")
        .eq("preparation_status", "preparing") // can't skip straight from not_started / twice
    );
  }

  function requestRider(orderId: string) {
    act(`${orderId}:rider`, () => supabase.from("delivery_requests").insert({ order_id: orderId, kitchen_id: kitchenId }));
  }

  function refresh() {
    run("refresh", () => load(true));
  }

  if (loading) {
    return <SkeletonCards count={3} />;
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-xl px-3 py-2 text-xs" style={{ background: "rgba(239,68,68,0.15)", color: "#FCA5A5" }}>
          {error}
        </p>
      )}

      <section>
        <h3 className="text-xs font-semibold uppercase" style={{ color: "var(--kb-on-navy-soft)" }}>
          New orders
        </h3>
        {newOrders.length === 0 ? (
          <p className="mt-2 rounded-2xl bg-white p-4 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
            No new orders right now.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {newOrders.map((o) => (
              <div key={o.id} className="rounded-2xl bg-white p-4" style={{ color: "var(--kb-ink)" }}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Order #{shortId(o.id)}</p>
                  <p className="text-sm font-semibold">${o.subtotal.toFixed(2)}</p>
                </div>
                <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>{itemsSummary(o)}</p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => decide(o.id, "accepted")}
                    disabled={busy}
                    className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                    style={{ background: "var(--kb-green-deep)" }}
                  >
                    <PendingLabel pending={isRunning(`${o.id}:accepted`)} pendingText="Accepting…">Accept</PendingLabel>
                  </button>
                  <button
                    onClick={() => decide(o.id, "rejected")}
                    disabled={busy}
                    className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                    style={{ background: "var(--kb-danger)" }}
                  >
                    <PendingLabel pending={isRunning(`${o.id}:rejected`)} pendingText="Rejecting…">Reject</PendingLabel>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase" style={{ color: "var(--kb-on-navy-soft)" }}>
          Awaiting PayNow
        </h3>
        {awaitingPayment.length === 0 ? (
          <p className="mt-2 rounded-2xl bg-white p-4 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
            No accepted orders waiting on payment.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {awaitingPayment.map((o) => (
              <div key={o.id} className="rounded-2xl bg-white p-4" style={{ color: "var(--kb-ink)" }}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Order #{shortId(o.id)}</p>
                  <p className="text-sm font-semibold">${o.subtotal.toFixed(2)}</p>
                </div>
                <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>{itemsSummary(o)}</p>
                <button
                  onClick={() => markPaid(o.id)}
                  disabled={busy}
                  className="mt-3 w-full rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: "var(--kb-purple)" }}
                >
                  <PendingLabel pending={isRunning(`${o.id}:paid`)} pendingText="Saving…">Mark PayNow received</PendingLabel>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase" style={{ color: "var(--kb-on-navy-soft)" }}>
          In the kitchen
        </h3>
        {inKitchen.length === 0 ? (
          <p className="mt-2 rounded-2xl bg-white p-4 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
            No accepted orders in prep right now.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {inKitchen.map((o) => (
              <div key={o.id} className="rounded-2xl bg-white p-4" style={{ color: "var(--kb-ink)" }}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Order #{shortId(o.id)}</p>
                  <p className="text-sm font-semibold">${o.subtotal.toFixed(2)}</p>
                </div>
                <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>{itemsSummary(o)}</p>
                {o.preparation_status === "not_started" && (
                  <button
                    onClick={() => startCooking(o.id)}
                    disabled={busy}
                    className="mt-3 w-full rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                    style={{ background: "var(--kb-green-deep)" }}
                  >
                    <PendingLabel pending={isRunning(`${o.id}:cook`)} pendingText="Starting…">Start Cooking</PendingLabel>
                  </button>
                )}
                {o.preparation_status === "preparing" && (
                  <button
                    onClick={() => markReady(o.id)}
                    disabled={busy}
                    className="mt-3 w-full rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                    style={{ background: "var(--kb-purple)" }}
                  >
                    <PendingLabel pending={isRunning(`${o.id}:ready`)} pendingText="Marking ready…">Mark Ready — Looking for Rider</PendingLabel>
                  </button>
                )}
                {o.preparation_status === "ready" && (() => {
                  const requests = o.delivery_requests ?? [];
                  const active = requests.find((r) => r.status === "open" || r.status === "accepted");
                  const delivered = requests.some((r) => r.status === "completed");

                  if (active) {
                    const rider = active.status === "accepted" ? riderDetails[active.id] : undefined;
                    return (
                      <div className="mt-3 overflow-hidden rounded-2xl" style={{ background: "linear-gradient(135deg, #F4EEFF 0%, #F8FAFC 100%)", border: "1px solid #E8DFFF" }}>
                        {active.status === "accepted" ? (
                          <>
                            <div className="flex items-center gap-3 p-3">
                              {rider?.photo_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={rider.photo_url} alt="Rider" className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-white shadow-sm" />
                              ) : (
                                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl font-bold text-white shadow-sm" style={{ background: "linear-gradient(135deg,var(--kb-purple),var(--kb-green))" }}>
                                  {(rider?.full_name?.trim()?.[0] ?? "R").toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="truncate text-sm font-bold">{rider?.full_name ?? "Rider assigned"}</p>
                                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={{ background: "#D7F5E7", color: "var(--kb-green-deep)" }}>
                                    On the way
                                  </span>
                                </div>
                                {rider?.phone && <p className="mt-0.5 text-xs" style={{ color: "var(--kb-ink-soft)" }}>📱 {rider.phone}</p>}
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                  {rider?.vehicle_type && <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold" style={{ color: "var(--kb-ink-soft)" }}>🛵 {rider.vehicle_type}</span>}
                                  {rider?.license_plate && <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold" style={{ color: "var(--kb-ink-soft)" }}>🔢 {rider.license_plate}</span>}
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 border-t p-3" style={{ borderColor: "#E8DFFF" }}>
                              {rider?.phone ? (
                                <a href={`tel:${rider.phone}`} className="flex items-center justify-center rounded-xl bg-white py-2.5 text-xs font-bold" style={{ color: "var(--kb-purple)" }}>
                                  📞 Call Rider
                                </a>
                              ) : (
                                <div className="rounded-xl bg-white py-2.5 text-center text-xs font-semibold" style={{ color: "var(--kb-ink-soft)" }}>Rider assigned</div>
                              )}
                              <button type="button" onClick={() => setOpenChatId(openChatId === active.id ? null : active.id)} className="rounded-xl py-2.5 text-xs font-bold text-white" style={{ background: "linear-gradient(135deg,var(--kb-purple),var(--kb-purple-deep))" }}>
                                {openChatId === active.id ? "Close Chat" : "💬 Chat with Rider"}
                              </button>
                            </div>
                            {openChatId === active.id && <div className="border-t p-3" style={{ borderColor: "#E8DFFF" }}><PartnerRiderChat deliveryRequestId={active.id} userId={kitchenId} /></div>}
                          </>
                        ) : (
                          <p className="p-3 text-center text-sm font-semibold" style={{ color: "var(--kb-ink-soft)" }}>Waiting for a rider</p>
                        )}
                      </div>
                    );
                  }

                  if (delivered) {
                    return (
                      <p className="mt-3 text-center text-sm font-semibold" style={{ color: "var(--kb-green-deep)" }}>
                        Delivered
                      </p>
                    );
                  }

                  return (
                    <button
                      onClick={() => requestRider(o.id)}
                      disabled={busy}
                      className="mt-3 w-full rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                      style={{ background: "var(--kb-purple)" }}
                    >
                      <PendingLabel pending={isRunning(`${o.id}:rider`)} pendingText="Requesting…">Request a rider</PendingLabel>
                    </button>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
      </section>

      <button
        onClick={refresh}
        disabled={busy}
        className="w-full rounded-2xl py-2.5 text-sm font-semibold disabled:opacity-60"
        style={{ background: "var(--kb-navy-raised)", color: "var(--kb-on-navy)" }}
      >
        <PendingLabel pending={isRunning("refresh")} pendingText="Refreshing…">Refresh</PendingLabel>
      </button>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { usePendingAction } from "@/lib/use-pending-action";
import { PendingLabel } from "./Pending";
import { SkeletonCards } from "./Skeleton";
import type { Order, OrderWithItems } from "@/lib/types-orders";
import type { DeliveryRequest, DeliveryRiderDetails } from "@/lib/types-delivery";
import { PartnerRiderChat } from "./PartnerRiderChat";
import { RiderLocationMap } from "./RiderLocationMap";

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

const PAYMENT_PROOF_BUCKET = "payment-proofs";
const PAYMENT_PROOF_URL_TTL_SECONDS = 60 * 60;

// "current" = a proof the cook hasn't rejected yet; "rejected" = the cook
// said the money didn't arrive and no newer proof has been uploaded since.
type ProofState = "none" | "current" | "rejected";

function proofState(order: Order): ProofState {
  if (!order.payment_proof_path) return "none";
  if (!order.payment_proof_rejected_at) return "current";
  const rejected = new Date(order.payment_proof_rejected_at).getTime();
  const uploaded = order.payment_proof_uploaded_at ? new Date(order.payment_proof_uploaded_at).getTime() : NaN;
  return uploaded > rejected ? "current" : "rejected";
}

function timeAgo(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function CookOrdersPanel({ kitchenId }: { kitchenId: string }) {
  const supabase = createClient();
  const [newOrders, setNewOrders] = useState<OrderWithItems[]>([]);
  const [awaitingPayment, setAwaitingPayment] = useState<OrderWithItems[]>([]);
  const [inKitchen, setInKitchen] = useState<OrderWithDelivery[]>([]);
  const [riderDetails, setRiderDetails] = useState<Record<string, DeliveryRiderDetails>>({});
  const [openChatId, setOpenChatId] = useState<string | null>(null);
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
  const requestedProofsRef = useRef(new Set<string>());
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

  // Sign any current payment proofs we haven't signed yet, in one batch. A
  // re-upload is a new key, so it gets signed (and shown) on the next refresh.
  useEffect(() => {
    const missing = awaitingPayment
      .filter((o) => proofState(o) === "current")
      .map((o) => o.payment_proof_path!)
      .filter((p) => !requestedProofsRef.current.has(p));
    if (missing.length === 0) return;
    for (const p of missing) requestedProofsRef.current.add(p);
    let cancelled = false;
    void supabase.storage
      .from(PAYMENT_PROOF_BUCKET)
      .createSignedUrls(missing, PAYMENT_PROOF_URL_TTL_SECONDS)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const signed: Record<string, string> = {};
        for (const item of data) if (item.path && item.signedUrl) signed[item.path] = item.signedUrl;
        setProofUrls((prev) => ({ ...prev, ...signed }));
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, awaitingPayment]);

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

  // Tells the customer the money didn't arrive; they can then upload a new proof.
  function rejectProof(orderId: string) {
    act(`${orderId}:proof-rejected`, () =>
      supabase
        .from("orders")
        .update({ payment_proof_rejected_at: new Date().toISOString() })
        .eq("id", orderId)
        .eq("order_status", "accepted")
        .eq("payment_status", "unpaid") // can't reject a proof once the order is paid
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
      <div className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Current order summary">
        <Metric label="Needs attention" value={newOrders.length + awaitingPayment.length} tone="purple" />
        <Metric label="Preparing" value={inKitchen.filter((o) => o.preparation_status === "preparing").length} tone="teal" />
        <Metric label="Ready" value={inKitchen.filter((o) => o.preparation_status === "ready").length} tone="neutral" />
      </div>
      {error && (
        <p className="rounded-xl px-3 py-2 text-xs" style={{ background: "#FEF0F0", color: "#B42318" }}>
          {error}
        </p>
      )}

      <section>
        <h3 className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: "var(--kb-ink-soft)" }}>
          New orders
        </h3>
        {newOrders.length === 0 ? (
          <p className="mt-2 rounded-2xl bg-white p-4 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
            No new orders right now.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {newOrders.map((o) => (
              <div key={o.id} className="partner-order-card rounded-2xl bg-white p-4" style={{ color: "var(--kb-ink)" }}>
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
        <h3 className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: "var(--kb-ink-soft)" }}>
          Awaiting PayNow
        </h3>
        {awaitingPayment.length === 0 ? (
          <p className="mt-2 rounded-2xl bg-white p-4 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
            No accepted orders waiting on payment.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {awaitingPayment.map((o) => {
              const proof = proofState(o);
              const proofUrl = proof === "current" ? proofUrls[o.payment_proof_path!] : undefined;
              return (
                <div key={o.id} className="partner-order-card rounded-2xl bg-white p-4" style={{ color: "var(--kb-ink)" }}>
                  {/* Same "#" + 8-char reference the Customer app shows, so cooks can match it to the PayNow comment. */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--kb-ink-soft)" }}>Order</p>
                      <p className="font-mono text-base font-bold tracking-wide">#{shortId(o.id)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--kb-ink-soft)" }}>You should receive</p>
                      <p className="text-base font-bold" style={{ color: "var(--kb-purple)" }}>${o.subtotal.toFixed(2)}</p>
                    </div>
                  </div>
                  <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>{itemsSummary(o)}</p>

                  {proof === "current" && (
                    <div className="mt-3 flex items-center gap-3 rounded-xl p-2" style={{ background: "var(--kb-tint)" }}>
                      {proofUrl ? (
                        <a href={proofUrl} target="_blank" rel="noopener noreferrer" className="shrink-0" aria-label="Open payment proof full size">
                          {/* Short-lived signed URL from a private bucket — next/image can't (and shouldn't) cache it. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={proofUrl} alt="Payment proof" className="h-16 w-16 rounded-lg object-cover ring-2 ring-white" />
                        </a>
                      ) : (
                        <div className="h-16 w-16 shrink-0 animate-pulse rounded-lg bg-white" aria-label="Loading payment proof" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">Payment proof</p>
                        {o.payment_proof_uploaded_at && (
                          <p className="text-xs" style={{ color: "var(--kb-ink-soft)" }}>Uploaded {timeAgo(o.payment_proof_uploaded_at)}</p>
                        )}
                        {proofUrl && <p className="text-xs font-semibold" style={{ color: "var(--kb-purple)" }}>Tap to view full size</p>}
                      </div>
                    </div>
                  )}
                  {proof === "none" && (
                    <p className="mt-3 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: "var(--kb-field)", color: "var(--kb-ink-soft)" }}>
                      Waiting for the customer&apos;s proof of payment
                    </p>
                  )}
                  {proof === "rejected" && (
                    <p className="mt-3 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: "#FEF3C7", color: "#92400E" }}>
                      You told the customer the payment wasn&apos;t received. Waiting for a new proof.
                    </p>
                  )}

                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => markPaid(o.id)}
                      disabled={busy}
                      className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                      style={{ background: "var(--kb-green-deep)" }}
                    >
                      <PendingLabel pending={isRunning(`${o.id}:paid`)} pendingText="Saving…">Payment received</PendingLabel>
                    </button>
                    {proof === "current" && (
                      <button
                        onClick={() => rejectProof(o.id)}
                        disabled={busy}
                        className="flex-1 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60"
                        style={{ background: "#FEF0F0", color: "#B42318" }}
                      >
                        <PendingLabel pending={isRunning(`${o.id}:proof-rejected`)} pendingText="Saving…">Not received</PendingLabel>
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-[11px]" style={{ color: "var(--kb-ink-soft)" }}>
                    Check your bank app first. Only tap Payment received if the money is in your account.
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: "var(--kb-ink-soft)" }}>
          In the kitchen
        </h3>
        {inKitchen.length === 0 ? (
          <p className="mt-2 rounded-2xl bg-white p-4 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
            No accepted orders in prep right now.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {inKitchen.map((o) => (
              <div key={o.id} className="partner-order-card rounded-2xl bg-white p-4" style={{ color: "var(--kb-ink)" }}>
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
                                    Rider assigned
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
                            <div className="border-t p-3" style={{ borderColor: "#E8DFFF" }}>
                              <button type="button" onClick={() => setTrackingId(trackingId === active.id ? null : active.id)} aria-expanded={trackingId === active.id} className="w-full rounded-xl bg-white py-2.5 text-xs font-bold" style={{ color: "var(--kb-purple)" }}>
                                {trackingId === active.id ? "Hide rider map" : "📍 Track rider"}
                              </button>
                              {trackingId === active.id && <div className="mt-2"><RiderLocationMap deliveryRequestId={active.id} /></div>}
                            </div>
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
        style={{ background: "#F1EDFA", color: "var(--kb-purple)" }}
      >
        <PendingLabel pending={isRunning("refresh")} pendingText="Refreshing…">Refresh</PendingLabel>
      </button>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "purple" | "teal" | "neutral" }) {
  const colors = tone === "purple" ? ["#F1EDFA", "var(--kb-purple)"] : tone === "teal" ? ["#E5F7EF", "var(--kb-green-deep)"] : ["#F5F4F7", "var(--kb-ink)"];
  return <div className="rounded-2xl border border-[#eceaf1] p-3 sm:p-4" style={{ background: colors[0] }}><span className="block text-xl font-bold sm:text-2xl" style={{ color: colors[1] }}>{value}</span><span className="mt-1 block text-[10px] font-semibold leading-tight sm:text-xs" style={{ color: "var(--kb-ink-soft)" }}>{label}</span></div>;
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { usePendingAction } from "@/lib/use-pending-action";
import { PendingLabel } from "./Pending";
import { SkeletonCards } from "./Skeleton";
import type { OrderWithItems } from "@/lib/types-orders";
import type { DeliveryRiderDetails } from "@/lib/types-delivery";
import { OrderDeliveryInfo } from "./OrderDeliveryInfo";
import { CookOrderCard, OrderAmounts, OrderLines, proofState, shortId, type OrderWithDelivery } from "./CookOrderCard";
import { riderView } from "@/lib/cook-order-card";
import { requestRider as requestRiderAction } from "@/lib/cook-order-actions";
import { cookOrderFinishedAt, cookOrderOutcome, formatFinishedAt, isCookOrderFinished, isMissingHiddenColumn, newestFirst } from "@/lib/past-orders";
import { hideAllCookOrders, hideCookOrder } from "@/lib/past-orders-actions";
import { PastOrdersSection } from "./PastOrdersSection";
import { orderTotal } from "@/lib/order-amounts";
import { isOrderOptionsUnavailable } from "@/lib/order-lines";

const PAYMENT_PROOF_BUCKET = "payment-proofs";
const PAYMENT_PROOF_URL_TTL_SECONDS = 60 * 60;

export function CookOrdersPanel({ kitchenId }: { kitchenId: string }) {
  const supabase = createClient();
  const [newOrders, setNewOrders] = useState<OrderWithItems[]>([]);
  // Every accepted order, one card each (CookOrderCard), from payment to delivery.
  const [activeOrders, setActiveOrders] = useState<OrderWithDelivery[]>([]);
  const awaitingPayment = useMemo(() => activeOrders.filter((o) => o.payment_status === "unpaid"), [activeOrders]);
  const paidOrders = activeOrders.filter((o) => o.payment_status === "paid");
  const [pastOrders, setPastOrders] = useState<OrderWithDelivery[]>([]);
  const [riderDetails, setRiderDetails] = useState<Record<string, DeliveryRiderDetails>>({});
  const [openChatId, setOpenChatId] = useState<string | null>(null);
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
  const requestedProofsRef = useRef(new Set<string>());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { busy, isRunning, run } = usePendingAction();
  // Ticks so a scheduled order's "Request rider" enables on time. Only
  // drives the button — the server action and the database check the real clock.
  const [now, setNow] = useState(() => Date.now());

  // `silent` = live refresh: update in place without flashing the loading state.
  const load = useCallback(async (silent?: boolean) => {
    if (silent !== true) setLoading(true);

    // Every order the cook hasn't removed from their list (cook_hidden_at,
    // docs/supabase-hide-past-orders.sql). Before that SQL runs the column
    // doesn't exist, so load without the filter rather than break the screen.
    // Likewise the add-ons picked (order_item_options): if the cook can't
    // read them, lines show without their add-on names (totals still right).
    const query = (hiddenFilter: boolean, withOptions: boolean) => {
      let q = supabase
        .from("orders")
        .select(withOptions ? "*, order_items(*, order_item_options(*)), delivery_requests(*)" : "*, order_items(*), delivery_requests(*)")
        .eq("kitchen_id", kitchenId);
      if (hiddenFilter) q = q.is("cook_hidden_at", null);
      return q.order("created_at", { ascending: true }).returns<OrderWithDelivery[]>();
    };
    let hiddenFilter = true;
    let withOptions = true;
    let { data, error: loadError } = await query(hiddenFilter, withOptions);
    for (let retry = 0; retry < 2 && loadError; retry++) {
      if (hiddenFilter && isMissingHiddenColumn(loadError, "cook_hidden_at")) hiddenFilter = false;
      else if (withOptions && isOrderOptionsUnavailable(loadError)) withOptions = false;
      else break;
      ({ data, error: loadError } = await query(hiddenFilter, withOptions));
    }

    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }

    // Finished (delivered and paid, cancelled, rejected) goes to "Past orders".
    const all = data ?? [];
    const rows = all.filter((o) => !isCookOrderFinished(o));
    setPastOrders(newestFirst(all.filter((o) => isCookOrderFinished(o)), cookOrderFinishedAt));
    setNewOrders(rows.filter((o) => o.order_status === "placed"));
    setActiveOrders(rows.filter((o) => o.order_status === "accepted"));

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

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

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

  // Server action, not a browser insert: a scheduled order can only get a
  // rider from 45 minutes before its time (see rider-request.ts).
  function requestRider(orderId: string) {
    run(`${orderId}:rider`, async () => {
      setError(null);
      const result = await requestRiderAction(orderId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await load(true);
    });
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
        <Metric label="Preparing" value={paidOrders.filter((o) => o.preparation_status === "preparing").length} tone="teal" />
        <Metric label="Ready" value={paidOrders.filter((o) => o.preparation_status === "ready").length} tone="neutral" />
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
                  <p className="text-sm font-semibold">S${orderTotal(o).toFixed(2)}</p>
                </div>
                <OrderLines order={o} />
                <OrderDeliveryInfo details={o} />
                <OrderAmounts order={o} />
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
          Orders in progress
        </h3>
        {activeOrders.length === 0 ? (
          <p className="mt-2 rounded-2xl bg-white p-4 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
            No accepted orders right now.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {activeOrders.map((o) => {
              // The request the rider panel's chat and map are about.
              const riderRequestId = riderView(o.delivery_requests).request?.id ?? null;
              return (
                <CookOrderCard
                  key={o.id}
                  order={o}
                  kitchenId={kitchenId}
                  riderDetails={riderDetails}
                  proofUrl={proofState(o) === "current" ? proofUrls[o.payment_proof_path!] : undefined}
                  now={now}
                  busy={busy}
                  isRunning={isRunning}
                  onMarkPaid={() => markPaid(o.id)}
                  onRejectProof={() => rejectProof(o.id)}
                  onStartCooking={() => startCooking(o.id)}
                  onMarkReady={() => markReady(o.id)}
                  onRequestRider={() => requestRider(o.id)}
                  chatOpen={riderRequestId !== null && openChatId === riderRequestId}
                  onToggleChat={() => setOpenChatId(openChatId === riderRequestId ? null : riderRequestId)}
                  trackingOpen={riderRequestId !== null && trackingId === riderRequestId}
                  onToggleTracking={() => setTrackingId(trackingId === riderRequestId ? null : riderRequestId)}
                />
              );
            })}
          </div>
        )}
      </section>

      <PastOrdersSection
        items={pastOrders}
        getId={(o) => o.id}
        renderItem={(o) => <CookPastOrder order={o} />}
        removeOne={hideCookOrder}
        removeAll={hideAllCookOrders}
        onRemoved={() => load(true)}
        pending={{ busy, isRunning, run }}
      />

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

function CookPastOrder({ order }: { order: OrderWithDelivery }) {
  const outcome = cookOrderOutcome(order);
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Order #{shortId(order.id)}</p>
          <p className="text-[11px]" style={{ color: "var(--kb-ink-soft)" }}>{formatFinishedAt(cookOrderFinishedAt(order))}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold">S${orderTotal(order).toFixed(2)}</p>
          <span
            className="mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
            style={outcome === "Delivered" ? { background: "#E5F7EF", color: "var(--kb-green-deep)" } : { background: "#FEF0F0", color: "#B42318" }}
          >
            {outcome}
          </span>
        </div>
      </div>
      <OrderLines order={order} />
      <OrderDeliveryInfo details={order} />
    </>
  );
}

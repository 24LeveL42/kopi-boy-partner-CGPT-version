"use client";

import { PendingLabel } from "./Pending";
import type { Order, OrderWithItems } from "@/lib/types-orders";
import type { DeliveryRequest, DeliveryRiderDetails } from "@/lib/types-delivery";
import { PartnerRiderChat } from "./PartnerRiderChat";
import { RiderLocationMap } from "./RiderLocationMap";
import { OrderDeliveryInfo } from "./OrderDeliveryInfo";
import { canRequestRiderAt, riderRequestOpensShortLabel } from "@/lib/rider-request";
import { canShowRequestRider, cookCardStage, riderView, type RiderStage } from "@/lib/cook-order-card";
// The customer PayNows the food total (after any deal) + delivery fee, so
// orderTotal is what the cook should look for in their bank app.
import { orderDeliveryFee, orderDiscount, orderTotal } from "@/lib/order-amounts";
import { orderLine } from "@/lib/order-lines";

export interface OrderWithDelivery extends OrderWithItems {
  delivery_requests: DeliveryRequest[];
}

// Cooks can't read the customer's profile (no RLS policy grants that), so
// order cards are identified by a short id + timestamp, not a customer name.
export function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}

// "current" = a proof the cook hasn't rejected yet; "rejected" = the cook
// said the money didn't arrive and no newer proof has been uploaded since.
type ProofState = "none" | "current" | "rejected";

export function proofState(order: Order): ProofState {
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

// One row per dish: "Laksa x2  (Hot, Extra egg)" with its line total
// (dish price + add-ons) × quantity on the right.
export function OrderLines({ order }: { order: OrderWithItems }) {
  return (
    <ul className="mt-1 space-y-0.5 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
      {order.order_items.map((item, i) => {
        const line = orderLine(item);
        return (
          <li key={item.id ?? i} className="flex justify-between gap-3">
            <span className="min-w-0">
              <span style={{ color: "var(--kb-ink)" }}>{line.label}</span>
              {line.options && <span> ({line.options})</span>}
            </span>
            <span className="shrink-0">S${line.total.toFixed(2)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function OrderAmounts({ order }: { order: Order }) {
  const discount = orderDiscount(order);
  return (
    <div className="mt-3 rounded-xl p-3 text-xs" style={{ background: "var(--kb-field)" }}>
      <div className="flex justify-between" style={{ color: "var(--kb-ink-soft)" }}>
        <span>Food subtotal</span>
        <span>S${Number(order.subtotal).toFixed(2)}</span>
      </div>
      {discount > 0 && (
        <div className="mt-1 flex justify-between gap-3" style={{ color: "var(--kb-green-deep)" }}>
          <span className="min-w-0 truncate">Deal{order.promotion_label ? ` · ${order.promotion_label}` : ""}</span>
          <span className="shrink-0">-S${discount.toFixed(2)}</span>
        </div>
      )}
      <div className="mt-1 flex justify-between" style={{ color: "var(--kb-ink-soft)" }}>
        <span>Delivery fee</span>
        <span>S${orderDeliveryFee(order).toFixed(2)}</span>
      </div>
      <p className="text-[11px]" style={{ color: "var(--kb-ink-soft)" }}>You pay this fee to the rider at pickup.</p>
      <div className="mt-2 flex justify-between border-t pt-2 text-sm font-bold" style={{ borderColor: "#E8DFFF", color: "var(--kb-ink)" }}>
        <span>Customer pays in total</span>
        <span style={{ color: "var(--kb-purple)" }}>S${orderTotal(order).toFixed(2)}</span>
      </div>
    </div>
  );
}

const RIDER_STATUS_TEXT: Record<Exclude<RiderStage, "none" | "released">, string> = {
  requested: "Rider requested",
  accepted: "Rider on the way",
  picked_up: "Picked up",
  delivered: "Delivered",
};

// Same height as a button, so a status sits level with the button beside it.
const CELL = "flex min-h-[44px] items-center justify-center rounded-xl px-2 py-2.5 text-center text-sm font-semibold leading-tight";

function RiderStatusCell({ stage }: { stage: Exclude<RiderStage, "none" | "released"> }) {
  const done = stage === "picked_up" || stage === "delivered";
  return (
    <div className={CELL} style={done ? { background: "#E5F7EF", color: "var(--kb-green-deep)" } : { background: "#F1EDFA", color: "var(--kb-purple)" }} role="status">
      {done ? "✓ " : ""}
      {RIDER_STATUS_TEXT[stage]}
    </div>
  );
}

export interface CookOrderCardProps {
  order: OrderWithDelivery;
  kitchenId: string;
  /** Rider shown on an accepted request (get_delivery_rider), keyed by request id. */
  riderDetails: Record<string, DeliveryRiderDetails>;
  /** Signed URL for the current payment proof, once signed. */
  proofUrl?: string;
  now: number;
  busy: boolean;
  isRunning: (key: string) => boolean;
  onMarkPaid: () => void;
  onRejectProof: () => void;
  onStartCooking: () => void;
  onMarkReady: () => void;
  onRequestRider: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  trackingOpen: boolean;
  onToggleTracking: () => void;
}

/**
 * One card per accepted order. The details show once; the action area below
 * changes in place: payment first, then Start Cooking / Mark Ready with
 * Request rider (or the rider's status) beside it, then the rider panel.
 */
export function CookOrderCard(props: CookOrderCardProps) {
  const { order: o, busy, isRunning } = props;
  const stage = cookCardStage(o);
  const rider = riderView(o.delivery_requests);
  const showRequest = canShowRequestRider(stage, rider.stage);
  const proof = proofState(o);
  const total = orderTotal(o);

  return (
    <div className="partner-order-card rounded-2xl bg-white p-4" style={{ color: "var(--kb-ink)" }}>
      {/* Same "#" + 8-char reference the Customer app shows, so cooks can match it to the PayNow comment. */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--kb-ink-soft)" }}>Order</p>
          <p className="font-mono text-base font-bold tracking-wide">#{shortId(o.id)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--kb-ink-soft)" }}>
            {stage === "unpaid" ? "You should receive" : "Paid"}
          </p>
          <p className="text-base font-bold" style={{ color: stage === "unpaid" ? "var(--kb-purple)" : "var(--kb-green-deep)" }}>
            {stage === "unpaid" ? "" : "✓ "}S${total.toFixed(2)}
          </p>
        </div>
      </div>
      <OrderLines order={o} />
      <OrderDeliveryInfo details={o} />
      <OrderAmounts order={o} />

      {stage === "unpaid" ? (
        <>
          {proof === "current" && (
            <div className="mt-3 flex items-center gap-3 rounded-xl p-2" style={{ background: "var(--kb-tint)" }}>
              {props.proofUrl ? (
                <a href={props.proofUrl} target="_blank" rel="noopener noreferrer" className="shrink-0" aria-label="Open payment proof full size">
                  {/* Short-lived signed URL from a private bucket — next/image can't (and shouldn't) cache it. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={props.proofUrl} alt="Payment proof" className="h-16 w-16 rounded-lg object-cover ring-2 ring-white" />
                </a>
              ) : (
                <div className="h-16 w-16 shrink-0 animate-pulse rounded-lg bg-white" aria-label="Loading payment proof" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold">Payment proof</p>
                {o.payment_proof_uploaded_at && (
                  <p className="text-xs" style={{ color: "var(--kb-ink-soft)" }}>Uploaded {timeAgo(o.payment_proof_uploaded_at)}</p>
                )}
                {props.proofUrl && <p className="text-xs font-semibold" style={{ color: "var(--kb-purple)" }}>Tap to view full size</p>}
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
              onClick={props.onMarkPaid}
              disabled={busy}
              className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--kb-green-deep)" }}
            >
              <PendingLabel pending={isRunning(`${o.id}:paid`)} pendingText="Saving…">Payment received</PendingLabel>
            </button>
            {proof === "current" && (
              <button
                onClick={props.onRejectProof}
                disabled={busy}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60"
                style={{ background: "#FEF0F0", color: "#B42318" }}
              >
                <PendingLabel pending={isRunning(`${o.id}:proof-rejected`)} pendingText="Saving…">Not received</PendingLabel>
              </button>
            )}
          </div>
          <p className="mt-2 text-[11px]" style={{ color: "var(--kb-ink-soft)" }}>
            Check your bank app for the full total of S${total.toFixed(2)}. Only tap Payment received if that amount is in your account.
          </p>
          {/* Older orders could get a rider before payment; keep showing where that rider is. */}
          {rider.stage !== "none" && rider.stage !== "released" && (
            <div className="mt-3">
              <RiderStatusCell stage={rider.stage} />
            </div>
          )}
        </>
      ) : (
        <>
          {rider.stage === "released" && (
            <p className="mt-3 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: "#FEF3C7", color: "#92400E" }} role="status">
              Rider dropped this delivery. Request rider again to find another.
            </p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {stage === "not_started" && (
              <button
                onClick={props.onStartCooking}
                disabled={busy}
                className="min-h-[44px] rounded-xl px-2 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "var(--kb-green-deep)" }}
              >
                <PendingLabel pending={isRunning(`${o.id}:cook`)} pendingText="Starting…">Start Cooking</PendingLabel>
              </button>
            )}
            {stage === "preparing" && (
              <button
                onClick={props.onMarkReady}
                disabled={busy}
                className="min-h-[44px] rounded-xl px-2 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "var(--kb-green-deep)" }}
              >
                <PendingLabel pending={isRunning(`${o.id}:ready`)} pendingText="Saving…">Mark Ready</PendingLabel>
              </button>
            )}
            {stage === "ready" && (
              <div className={CELL} style={{ background: "#E5F7EF", color: "var(--kb-green-deep)" }} role="status">
                ✓ Ready
              </div>
            )}

            {showRequest ? (
              <RequestRiderButton {...props} />
            ) : (
              rider.stage !== "none" && rider.stage !== "released" && <RiderStatusCell stage={rider.stage} />
            )}
          </div>
        </>
      )}

      {rider.request && (rider.stage === "accepted" || rider.stage === "picked_up") && (
        <RiderPanel {...props} requestId={rider.request.id} />
      )}
    </div>
  );
}

function RequestRiderButton({ order: o, now, busy, isRunning, onRequestRider }: CookOrderCardProps) {
  // Only drives the button — the server action and the database check the real clock.
  const tooEarly = !canRequestRiderAt(o.scheduled_for, now);
  return (
    <button
      onClick={onRequestRider}
      disabled={busy || tooEarly}
      className="min-h-[44px] rounded-xl px-2 py-2.5 text-sm font-semibold leading-tight text-white disabled:opacity-60"
      style={{ background: "var(--kb-purple)" }}
    >
      <PendingLabel pending={isRunning(`${o.id}:rider`)} pendingText="Requesting…">
        {tooEarly ? riderRequestOpensShortLabel(o.scheduled_for) : "Request rider"}
      </PendingLabel>
    </button>
  );
}

function RiderPanel({ requestId, kitchenId, riderDetails, chatOpen, onToggleChat, trackingOpen, onToggleTracking }: CookOrderCardProps & { requestId: string }) {
  const rider = riderDetails[requestId];
  return (
    <div className="mt-3 overflow-hidden rounded-2xl" style={{ background: "linear-gradient(135deg, #F4EEFF 0%, #F8FAFC 100%)", border: "1px solid #E8DFFF" }}>
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
          <p className="truncate text-sm font-bold">{rider?.full_name ?? "Your rider"}</p>
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
          <div className="rounded-xl bg-white py-2.5 text-center text-xs font-semibold" style={{ color: "var(--kb-ink-soft)" }}>No phone number</div>
        )}
        <button type="button" onClick={onToggleChat} className="rounded-xl py-2.5 text-xs font-bold text-white" style={{ background: "linear-gradient(135deg,var(--kb-purple),var(--kb-purple-deep))" }}>
          {chatOpen ? "Close Chat" : "💬 Chat with Rider"}
        </button>
      </div>
      {chatOpen && <div className="border-t p-3" style={{ borderColor: "#E8DFFF" }}><PartnerRiderChat deliveryRequestId={requestId} userId={kitchenId} /></div>}
      <div className="border-t p-3" style={{ borderColor: "#E8DFFF" }}>
        <button type="button" onClick={onToggleTracking} aria-expanded={trackingOpen} className="w-full rounded-xl bg-white py-2.5 text-xs font-bold" style={{ color: "var(--kb-purple)" }}>
          {trackingOpen ? "Hide rider map" : "📍 Track rider"}
        </button>
        {trackingOpen && <div className="mt-2"><RiderLocationMap deliveryRequestId={requestId} /></div>}
      </div>
    </div>
  );
}

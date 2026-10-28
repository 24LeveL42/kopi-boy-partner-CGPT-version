"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { usePendingAction } from "@/lib/use-pending-action";
import type { DeliveryRequestWithKitchen } from "@/lib/types-delivery";
import { OrderChat } from "@/components/OrderChat";
import { PartnerRiderChat } from "@/components/PartnerRiderChat";
import { PendingLabel } from "@/components/Pending";
import { SkeletonCards } from "@/components/Skeleton";
import { ORDER_CHAT_PHOTO_TYPES, uploadOrderChatPhoto, validateOrderChatPhoto } from "@/lib/order-chat-photo";
import { formatKitchenAddress, kitchenMapsUrl, publicKitchenArea, type KitchenLocation } from "@/lib/kitchen-profile";
import { acceptDelivery, completeDelivery, markCollected } from "@/lib/rider-delivery-actions";
import { isCollected } from "@/lib/rider-delivery";
import { loadDeliveryOrderDetails, type OrderDeliveryDetails } from "@/lib/order-delivery";
import { OrderDeliveryInfo } from "@/components/OrderDeliveryInfo";
import { PastOrdersSection } from "@/components/PastOrdersSection";
import { formatFinishedAt, isMissingHiddenColumn, newestFirst, riderJobFinishedAt, riderJobOutcome } from "@/lib/past-orders";
import { hideAllRiderJobs, hideRiderJob } from "@/lib/past-orders-actions";
import { RiderTrackingShare } from "@/components/RiderTrackingShare";

interface RawRow {
  id: string;
  order_id: string;
  kitchen_id: string;
  rider_id: string | null;
  status: string;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  picked_up_at?: string | null; // missing until docs/supabase-delivery-pickup.sql runs
  kitchens: { business_name: string; postal_sector: string | null } | null;
}

function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}

// location is only ever passed for the rider's own accepted delivery.
function toRow(r: RawRow, delivery: OrderDeliveryDetails | null, location?: KitchenLocation | null): DeliveryRequestWithKitchen {
  return {
    id: r.id,
    order_id: r.order_id,
    kitchen_id: r.kitchen_id,
    rider_id: r.rider_id,
    status: r.status as DeliveryRequestWithKitchen["status"],
    created_at: r.created_at,
    accepted_at: r.accepted_at,
    completed_at: r.completed_at,
    picked_up_at: r.picked_up_at,
    kitchen_business_name: r.kitchens?.business_name ?? "Unknown kitchen",
    kitchen_address: (location && formatKitchenAddress(location)) || publicKitchenArea(r.kitchens?.postal_sector),
    kitchen_maps_url: location ? kitchenMapsUrl(location) : null,
    delivery,
  };
}

export function RiderDeliveriesPanel({ riderId }: { riderId: string }) {
  const supabase = createClient();
  const [openRequests, setOpenRequests] = useState<DeliveryRequestWithKitchen[]>([]);
  const [myDelivery, setMyDelivery] = useState<DeliveryRequestWithKitchen | null>(null);
  const [completedToday, setCompletedToday] = useState(0);
  const [pastJobs, setPastJobs] = useState<DeliveryRequestWithKitchen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { busy, isRunning, run } = usePendingAction();
  // "Mark delivered" opens the confirm step; a photo for the customer is optional.
  const [proofOpen, setProofOpen] = useState(false);
  // "I've collected the food" asks once more before it notifies the customer.
  const [collectConfirmOpen, setCollectConfirmOpen] = useState(false);
  const [partnerChatOpen, setPartnerChatOpen] = useState(false);
  const [proofPhoto, setProofPhoto] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  // Key of proofPhoto once uploaded, so retrying after a failed completion
  // doesn't upload the same file again.
  const [proofPath, setProofPath] = useState<string | null>(null);
  const proofInputRef = useRef<HTMLInputElement>(null);

  // `silent` = live refresh: update in place without flashing the loading state.
  const load = useCallback(async (silent?: boolean) => {
    if (silent !== true) setLoading(true);
    setError(null);

    const { data: mine, error: mineError } = await supabase
      .from("delivery_requests")
      .select("*, kitchens(business_name, postal_sector)")
      .eq("rider_id", riderId)
      .eq("status", "accepted")
      .maybeSingle<RawRow>();

    if (mineError) {
      setError(mineError.message);
      setLoading(false);
      return;
    }

    // Counts every delivery, including ones removed from the list below.
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from("delivery_requests")
      .select("id", { count: "exact", head: true })
      .eq("rider_id", riderId)
      .eq("status", "completed")
      .gte("completed_at", startOfDay.toISOString());
    setCompletedToday(count ?? 0);

    // Finished jobs the rider hasn't removed from their list (rider_hidden_at,
    // docs/supabase-hide-past-orders.sql). Before that SQL runs the column
    // doesn't exist, so load without the filter rather than break the screen.
    const pastQuery = (hiddenFilter: boolean) => {
      let q = supabase
        .from("delivery_requests")
        .select("*, kitchens(business_name, postal_sector)")
        .eq("rider_id", riderId)
        .in("status", ["completed", "cancelled"]);
      if (hiddenFilter) q = q.is("rider_hidden_at", null);
      return q.returns<RawRow[]>();
    };
    let { data: past, error: pastError } = await pastQuery(true);
    if (isMissingHiddenColumn(pastError, "rider_hidden_at")) ({ data: past, error: pastError } = await pastQuery(false));
    if (pastError) setError(pastError.message);
    // Drop-off details end with the job (get_delivery_order_details), so past cards don't get them.
    setPastJobs(newestFirst((past ?? []).map((r) => toRow(r, null)), riderJobFinishedAt));

    if (mine) {
      // The exact address/postal code/coordinates are private; the DB hands
      // them over only while this rider holds the accepted delivery (schema
      // section 30). If that call fails, the card shows the postal sector.
      const [{ data: location }, details] = await Promise.all([
        supabase.rpc("get_delivery_kitchen_location", { p_delivery_request_id: mine.id }).maybeSingle<KitchenLocation>(),
        loadDeliveryOrderDetails(supabase, [mine.id]),
      ]);
      setMyDelivery(toRow(mine, details?.[mine.id] ?? null, location));
      setOpenRequests([]);
      setLoading(false);
      return;
    }

    setMyDelivery(null);

    const { data: open, error: openError } = await supabase
      .from("delivery_requests")
      .select("*, kitchens(business_name, postal_sector)")
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .returns<RawRow[]>();

    if (openError) {
      setError(openError.message);
      setLoading(false);
      return;
    }

    // Open jobs only get the drop-off area, Express and the requested time —
    // the address, unit and notes arrive once the rider accepts.
    const rows = open ?? [];
    const details = await loadDeliveryOrderDetails(supabase, rows.map((r) => r.id));
    setOpenRequests(rows.map((r) => toRow(r, details?.[r.id] ?? null)));
    setLoading(false);
  }, [supabase, riderId]);

  useEffect(() => {
    // Deferred so the initial setLoading(true) inside load() doesn't run
    // synchronously as part of the effect's own commit.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  // Open requests are visible to every rider (RLS scopes it), so no filter.
  useLiveRefresh([{ table: "delivery_requests" }], () => void load(true));

  function accept(requestId: string) {
    run(`${requestId}:accept`, async () => {
      setError(null);
      // Server action: refuses a blocked rider even from a stale page.
      const result = await acceptDelivery(requestId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await load(true);
    });
  }

  function confirmCollected(requestId: string) {
    run(`${requestId}:collect`, async () => {
      setError(null);
      // Server action: the database stamps the time and re-checks the rider/job.
      const result = await markCollected(requestId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCollectConfirmOpen(false);
      await load(true);
    });
  }

  const proofPreviewRef = useRef<string | null>(null);
  useEffect(() => () => {
    if (proofPreviewRef.current) URL.revokeObjectURL(proofPreviewRef.current);
  }, []);

  function setProof(file: File | null) {
    if (proofPreviewRef.current) URL.revokeObjectURL(proofPreviewRef.current);
    proofPreviewRef.current = file ? URL.createObjectURL(file) : null;
    setProofPreview(proofPreviewRef.current);
    setProofPhoto(file);
    setProofPath(null);
  }

  function closeProof() {
    setProofOpen(false);
    setProof(null);
    setError(null);
  }

  function handleProofPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = ""; // so picking the same file again still fires onChange
    if (!file) return;
    const problem = validateOrderChatPhoto(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setProof(file);
  }

  // The photo is optional. If one is attached, upload it first (the chat, and
  // so the bucket, is only open while the delivery is accepted), then post it
  // and complete the delivery in one transaction — see
  // docs/supabase-optional-delivery-photo.sql. Without one, just complete.
  function markDelivered() {
    if (!myDelivery) return;
    const delivery = myDelivery;
    const photo = proofPhoto;
    run(`${delivery.id}:deliver`, async () => {
      setError(null);

      let path = proofPath;
      if (photo && !path) {
        path = await uploadOrderChatPhoto(supabase, delivery.order_id, riderId, photo);
        if (!path) {
          setError(
            "Photo couldn't be uploaded — the delivery is not marked delivered yet. Please try again, or remove the photo to confirm without it."
          );
          return;
        }
        setProofPath(path);
      }

      const result = await completeDelivery(delivery.id, path);
      if (!result.ok) {
        setError(result.blocked ? result.error : `${result.error} The delivery is not marked delivered yet.`);
        return;
      }
      closeProof();
      await load(true);
    });
  }

  if (loading) {
    return <SkeletonCards count={2} />;
  }

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-xl px-3 py-2 text-xs" style={{ background: "#FEF0F0", color: "#B42318" }}>
          {error}
        </p>
      )}

      <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3" aria-label="Today's delivery summary">
        <RiderMetric label="Active delivery" value={myDelivery ? 1 : 0} tone="purple" />
        <RiderMetric label="Available" value={openRequests.length} tone="teal" />
        <RiderMetric label="Completed today" value={completedToday} tone="neutral" />
      </div>

      {myDelivery ? (
        <div className="partner-order-card rounded-2xl bg-white p-4 sm:p-5" style={{ color: "var(--kb-ink)" }}>
          <p className="text-xs font-medium uppercase" style={{ color: "var(--kb-purple)" }}>
            Your active delivery
          </p>
          <div className="mt-2 flex items-start justify-between gap-3">
            <p className="text-base font-bold">{myDelivery.kitchen_business_name}</p>
            <span className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide" style={{ background: "#E5F7EF", color: "var(--kb-green-deep)" }}>
              {isCollected(myDelivery) ? "On the way" : "Go to kitchen"}
            </span>
          </div>
          <p className="text-xs" style={{ color: "var(--kb-ink-soft)" }}>{myDelivery.kitchen_address}</p>
          {myDelivery.kitchen_maps_url && (
            <a
              href={myDelivery.kitchen_maps_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold"
              style={{ color: "var(--kb-purple)" }}
            >
              Open in Google Maps
            </a>
          )}
          <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>Order #{shortId(myDelivery.order_id)}</p>
          {myDelivery.delivery && <OrderDeliveryInfo details={myDelivery.delivery} />}
          <p className="mt-2 rounded-xl px-3 py-2 text-xs" style={{ color: "var(--kb-ink-soft)", background: "#F7F6FA" }}>
            Collect from the cook and coordinate the customer handoff with them. Agree the delivery fee directly with the cook.
          </p>
          <RiderTrackingShare riderId={riderId} deliveryRequestId={myDelivery.id} />
          {myDelivery.picked_up_at && (
            <p className="mt-3 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: "#E5F7EF", color: "var(--kb-green-deep)" }}>
              ✓ Food collected at {collectedTime(myDelivery.picked_up_at)}
            </p>
          )}
          {!isCollected(myDelivery) ? (
            collectConfirmOpen ? (
              <div className="mt-3 rounded-2xl p-3" style={{ background: "var(--kb-cream)" }}>
                <p className="text-sm font-semibold">Have you got the food from {myDelivery.kitchen_business_name}?</p>
                <p className="mt-0.5 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                  The customer and the cook will be told you&apos;re on the way. This can&apos;t be undone.
                </p>
                <button
                  onClick={() => confirmCollected(myDelivery.id)}
                  disabled={busy}
                  className="mt-3 w-full rounded-2xl py-3 text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: "var(--kb-green-deep)" }}
                >
                  <PendingLabel pending={isRunning(`${myDelivery.id}:collect`)} pendingText="Saving…">Yes, I have the food</PendingLabel>
                </button>
                <button
                  type="button"
                  onClick={() => setCollectConfirmOpen(false)}
                  disabled={busy}
                  className="mt-2 w-full text-xs font-semibold disabled:opacity-60"
                  style={{ color: "var(--kb-ink-soft)" }}
                >
                  Not yet
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setError(null);
                  setCollectConfirmOpen(true);
                }}
                className="mt-3 w-full rounded-2xl py-3 text-sm font-semibold text-white"
                style={{ background: "var(--kb-green-deep)" }}
              >
                I&apos;ve collected the food
              </button>
            )
          ) : proofOpen ? (
            <div className="mt-3 rounded-2xl p-3" style={{ background: "var(--kb-cream)" }}>
              <p className="text-sm font-semibold">Mark as delivered</p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                You can send the customer a photo of the delivery if you like. It&apos;s optional.
              </p>

              <input
                ref={proofInputRef}
                type="file"
                accept={ORDER_CHAT_PHOTO_TYPES.join(",")}
                onChange={handleProofPicked}
                className="hidden"
                aria-label="Add an optional delivery photo"
              />
              {proofPhoto ? (
                <div className="mt-2">
                  {proofPreview && (
                    // Local object URL of the picked file — nothing for next/image to optimise.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={proofPreview} alt="Delivery photo" className="max-h-48 w-full rounded-xl object-cover" />
                  )}
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">📎 {proofPhoto.name}</span>
                    <button
                      type="button"
                      onClick={() => setProof(null)}
                      disabled={busy}
                      className="shrink-0 font-semibold disabled:opacity-60"
                      style={{ color: "var(--kb-danger)" }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => proofInputRef.current?.click()}
                  disabled={busy}
                  className="mt-2 w-full rounded-xl border border-dashed py-3 text-sm font-semibold disabled:opacity-60"
                  style={{ borderColor: "var(--kb-navy-line)", color: "var(--kb-ink-soft)" }}
                >
                  Add a delivery photo (optional)
                </button>
              )}

              <button
                onClick={markDelivered}
                disabled={busy}
                className="mt-3 w-full rounded-2xl py-3 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "linear-gradient(110deg,var(--kb-purple),#6940D7)" }}
              >
                <PendingLabel pending={isRunning(`${myDelivery.id}:deliver`)} pendingText="Confirming delivery…">
                  Confirm delivered
                </PendingLabel>
              </button>
              <button
                type="button"
                onClick={closeProof}
                disabled={busy}
                className="mt-2 w-full text-xs font-semibold disabled:opacity-60"
                style={{ color: "var(--kb-ink-soft)" }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setProof(null);
                setProofOpen(true);
              }}
              className="mt-3 w-full rounded-2xl py-3 text-sm font-semibold text-white"
              style={{ background: "linear-gradient(110deg,var(--kb-purple),#6940D7)" }}
            >
              Mark delivered
            </button>
          )}

          <div className="mt-3 overflow-hidden rounded-2xl border" style={{ borderColor: "#E8DFFF", background: "linear-gradient(135deg,#F4EEFF 0%,#FFFFFF 100%)" }}>
            <button
              type="button"
              onClick={() => setPartnerChatOpen((open) => !open)}
              className="flex w-full items-center justify-between p-3 text-left"
            >
              <div>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--kb-purple)" }}>Cook coordination</p>
                <p className="mt-0.5 text-sm font-bold" style={{ color: "var(--kb-ink)" }}>Chat with Partner</p>
              </div>
              <span className="rounded-full px-3 py-1.5 text-xs font-bold text-white" style={{ background: "var(--kb-purple)" }}>
                {partnerChatOpen ? "Close" : "Open Chat"}
              </span>
            </button>
            {partnerChatOpen && (
              <div className="border-t p-3" style={{ borderColor: "#E8DFFF" }}>
                <PartnerRiderChat deliveryRequestId={myDelivery.id} userId={riderId} />
              </div>
            )}
          </div>

          <OrderChat orderId={myDelivery.order_id} userId={riderId} />
        </div>
      ) : (
        <>
          <RiderTrackingShare riderId={riderId} deliveryRequestId={null} />
          {openRequests.length === 0 ? (
            <p className="rounded-2xl bg-white p-4 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
              No open delivery requests right now — check back later.
            </p>
          ) : (
            <div className="space-y-2">
              {openRequests.map((r) => (
                  <div key={r.id} className="partner-order-card rounded-2xl bg-white p-4" style={{ color: "var(--kb-ink)" }}>
                  <p className="text-sm font-semibold">{r.kitchen_business_name}</p>
                  <p className="text-xs" style={{ color: "var(--kb-ink-soft)" }}>{r.kitchen_address}</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>Order #{shortId(r.order_id)}</p>
                  {r.delivery && <OrderDeliveryInfo details={r.delivery} />}
                  <button
                    onClick={() => accept(r.id)}
                    disabled={busy}
                    className="mt-3 w-full rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                    style={{ background: "var(--kb-purple)" }}
                  >
                    <PendingLabel pending={isRunning(`${r.id}:accept`)} pendingText="Accepting…">Accept</PendingLabel>
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => run("refresh", () => load(true))}
            disabled={busy}
            className="mt-3 w-full rounded-2xl py-2.5 text-sm font-semibold disabled:opacity-60"
            style={{ background: "var(--kb-navy-raised)", color: "var(--kb-on-navy)" }}
          >
            <PendingLabel pending={isRunning("refresh")} pendingText="Refreshing…">Refresh</PendingLabel>
          </button>
        </>
      )}

      <div className="mt-4">
        <PastOrdersSection
          items={pastJobs}
          getId={(j) => j.id}
          renderItem={(j) => <RiderPastJob job={j} />}
          removeOne={hideRiderJob}
          removeAll={hideAllRiderJobs}
          onRemoved={() => load(true)}
          pending={{ busy, isRunning, run }}
        />
      </div>
    </div>
  );
}

function RiderPastJob({ job }: { job: DeliveryRequestWithKitchen }) {
  const outcome = riderJobOutcome(job);
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{job.kitchen_business_name}</p>
        <p className="text-xs" style={{ color: "var(--kb-ink-soft)" }}>Order #{shortId(job.order_id)}</p>
        <p className="text-[11px]" style={{ color: "var(--kb-ink-soft)" }}>{formatFinishedAt(riderJobFinishedAt(job))}</p>
      </div>
      <span
        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
        style={outcome === "Delivered" ? { background: "#E5F7EF", color: "var(--kb-green-deep)" } : { background: "#FEF0F0", color: "#B42318" }}
      >
        {outcome}
      </span>
    </div>
  );
}

// "6:12 pm", Singapore time.
function collectedTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-SG", { timeZone: "Asia/Singapore", hour: "numeric", minute: "2-digit" });
}

function RiderMetric({ label, value, tone }: { label: string; value: number; tone: "purple" | "teal" | "neutral" }) {
  const colors = tone === "purple" ? ["#F1EDFA", "var(--kb-purple)"] : tone === "teal" ? ["#E5F7EF", "var(--kb-green-deep)"] : ["#F5F4F7", "var(--kb-ink)"];
  return <div className="rounded-2xl border border-[#eceaf1] p-3 sm:p-4" style={{ background: colors[0] }}><span className="block text-xl font-bold sm:text-2xl" style={{ color: colors[1] }}>{value}</span><span className="mt-1 block text-[10px] font-semibold leading-tight sm:text-xs" style={{ color: "var(--kb-ink-soft)" }}>{label}</span></div>;
}

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

interface RawRow {
  id: string;
  order_id: string;
  kitchen_id: string;
  rider_id: string | null;
  status: string;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  kitchens: { business_name: string; postal_sector: string | null } | null;
}

function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}

// location is only ever passed for the rider's own accepted delivery.
function toRow(r: RawRow, location?: KitchenLocation | null): DeliveryRequestWithKitchen {
  return {
    id: r.id,
    order_id: r.order_id,
    kitchen_id: r.kitchen_id,
    rider_id: r.rider_id,
    status: r.status as DeliveryRequestWithKitchen["status"],
    created_at: r.created_at,
    accepted_at: r.accepted_at,
    completed_at: r.completed_at,
    kitchen_business_name: r.kitchens?.business_name ?? "Unknown kitchen",
    kitchen_address: (location && formatKitchenAddress(location)) || publicKitchenArea(r.kitchens?.postal_sector),
    kitchen_maps_url: location ? kitchenMapsUrl(location) : null,
  };
}

export function RiderDeliveriesPanel({ riderId }: { riderId: string }) {
  const supabase = createClient();
  const [openRequests, setOpenRequests] = useState<DeliveryRequestWithKitchen[]>([]);
  const [myDelivery, setMyDelivery] = useState<DeliveryRequestWithKitchen | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { busy, isRunning, run } = usePendingAction();
  // Proof-of-delivery step: "Mark delivered" opens it, and completing needs a photo.
  const [proofOpen, setProofOpen] = useState(false);
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

    if (mine) {
      // The exact address/postal code/coordinates are private; the DB hands
      // them over only while this rider holds the accepted delivery (schema
      // section 30). If that call fails, the card shows the postal sector.
      const { data: location } = await supabase
        .rpc("get_delivery_kitchen_location", { p_delivery_request_id: mine.id })
        .maybeSingle<KitchenLocation>();
      setMyDelivery(toRow(mine, location));
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

    setOpenRequests((open ?? []).map((r) => toRow(r)));
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
      const { error: acceptError } = await supabase
        .from("delivery_requests")
        .update({ rider_id: riderId, status: "accepted", accepted_at: new Date().toISOString() })
        .eq("id", requestId)
        .eq("status", "open"); // first to accept wins — a second rider's update matches 0 rows
      if (acceptError) {
        setError(acceptError.message);
        return;
      }
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

  // Upload first (the chat, and so the bucket, is only open while the delivery
  // is accepted), then post the photo message and complete the delivery in one
  // transaction — see complete_delivery_with_proof in docs/supabase-messages.sql.
  function markDelivered() {
    if (!myDelivery || !proofPhoto) return;
    const delivery = myDelivery;
    const photo = proofPhoto;
    run(`${delivery.id}:deliver`, async () => {
      setError(null);

      let path = proofPath;
      if (!path) {
        path = await uploadOrderChatPhoto(supabase, delivery.order_id, riderId, photo);
        if (!path) {
          setError("Photo couldn't be uploaded — the delivery is not marked delivered yet. Please try again.");
          return;
        }
        setProofPath(path);
      }

      const { error: deliveredError } = await supabase.rpc("complete_delivery_with_proof", {
        p_request_id: delivery.id,
        p_photo_path: path,
      });
      if (deliveredError) {
        setError(`${deliveredError.message} The delivery is not marked delivered yet.`);
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
        <p className="mb-3 rounded-xl px-3 py-2 text-xs" style={{ background: "rgba(239,68,68,0.15)", color: "#FCA5A5" }}>
          {error}
        </p>
      )}

      {myDelivery ? (
        <div className="rounded-2xl bg-white p-4" style={{ color: "var(--kb-ink)" }}>
          <p className="text-xs font-medium uppercase" style={{ color: "var(--kb-purple)" }}>
            Your active delivery
          </p>
          <p className="mt-1 text-sm font-semibold">{myDelivery.kitchen_business_name}</p>
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
          <p className="mt-2 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
            Collect from the cook and agree the delivery fee directly with them.
          </p>
          {proofOpen ? (
            <div className="mt-3 rounded-2xl p-3" style={{ background: "var(--kb-cream)" }}>
              <p className="text-sm font-semibold">Proof of delivery</p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                Attach a photo of the handed-over order. It&apos;s posted to the customer chat when you confirm.
              </p>

              <input
                ref={proofInputRef}
                type="file"
                accept={ORDER_CHAT_PHOTO_TYPES.join(",")}
                onChange={handleProofPicked}
                className="hidden"
                aria-label="Attach proof-of-delivery photo"
              />
              {proofPhoto ? (
                <div className="mt-2">
                  {proofPreview && (
                    // Local object URL of the picked file — nothing for next/image to optimise.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={proofPreview} alt="Proof-of-delivery photo" className="max-h-48 w-full rounded-xl object-cover" />
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
                  Attach photo
                </button>
              )}

              <button
                onClick={markDelivered}
                disabled={!proofPhoto || busy}
                className="mt-3 w-full rounded-2xl py-3 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "var(--kb-green-deep)" }}
              >
                <PendingLabel pending={isRunning(`${myDelivery.id}:deliver`)} pendingText="Confirming delivery…">
                  {proofPhoto ? "Confirm delivered" : "Attach a photo to confirm"}
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
              style={{ background: "var(--kb-green-deep)" }}
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
          {openRequests.length === 0 ? (
            <p className="rounded-2xl bg-white p-4 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
              No open delivery requests right now — check back later.
            </p>
          ) : (
            <div className="space-y-2">
              {openRequests.map((r) => (
                <div key={r.id} className="rounded-2xl bg-white p-4" style={{ color: "var(--kb-ink)" }}>
                  <p className="text-sm font-semibold">{r.kitchen_business_name}</p>
                  <p className="text-xs" style={{ color: "var(--kb-ink-soft)" }}>{r.kitchen_address}</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>Order #{shortId(r.order_id)}</p>
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
    </div>
  );
}

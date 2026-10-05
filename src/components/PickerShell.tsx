"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { usePendingAction } from "@/lib/use-pending-action";
import { TopBar } from "./TopBar";
import { PickupChat } from "./PickupChat";
import { PendingLabel } from "./Pending";
import { SkeletonCards } from "./Skeleton";
import { ProfileSummaryCard, type ProfileSummary } from "./ProfileSummaryCard";
import type { PickupRequestWithKitchen } from "@/lib/types-picker";
import { formatKitchenAddress, kitchenMapsUrl, publicKitchenArea, type KitchenLocation } from "@/lib/kitchen-profile";

interface RawRow {
  id: string;
  rider_id: string;
  kitchen_id: string;
  picker_id: string | null;
  status: string;
  suggested_fee: number;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  kitchens: { business_name: string; postal_sector: string | null } | null;
}

// location is only ever passed for the picker's own accepted pickup.
function toRow(r: RawRow, location?: KitchenLocation | null): PickupRequestWithKitchen {
  return {
    id: r.id,
    rider_id: r.rider_id,
    kitchen_id: r.kitchen_id,
    picker_id: r.picker_id,
    status: r.status as PickupRequestWithKitchen["status"],
    suggested_fee: r.suggested_fee,
    created_at: r.created_at,
    accepted_at: r.accepted_at,
    completed_at: r.completed_at,
    kitchen_business_name: r.kitchens?.business_name ?? "Unknown kitchen",
    kitchen_address: (location && formatKitchenAddress(location)) || publicKitchenArea(r.kitchens?.postal_sector),
    kitchen_maps_url: location ? kitchenMapsUrl(location) : null,
  };
}

export function PickerShell({ userId, profile }: { userId: string; profile?: ProfileSummary }) {
  const supabase = createClient();
  const [openRequests, setOpenRequests] = useState<PickupRequestWithKitchen[]>([]);
  const [myPickup, setMyPickup] = useState<PickupRequestWithKitchen | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { busy, isRunning, run } = usePendingAction();

  // `silent` = live refresh: update in place without flashing the loading state.
  const load = useCallback(async (silent?: boolean) => {
    if (silent !== true) setLoading(true);

    const { data: mine } = await supabase
      .from("pickup_requests")
      .select("*, kitchens(business_name, postal_sector)")
      .eq("picker_id", userId)
      .eq("status", "accepted")
      .maybeSingle<RawRow>();

    if (mine) {
      // The exact address/postal code/coordinates are private; the DB hands
      // them over only while this picker holds the accepted pickup and its
      // rider holds an accepted delivery at that kitchen (schema section 30).
      // Otherwise the card shows the postal sector.
      const { data: location } = await supabase
        .rpc("get_pickup_kitchen_location", { p_pickup_request_id: mine.id })
        .maybeSingle<KitchenLocation>();
      setMyPickup(toRow(mine, location));
      setOpenRequests([]);
      setLoading(false);
      return;
    }

    setMyPickup(null);

    const { data: open } = await supabase
      .from("pickup_requests")
      .select("*, kitchens(business_name, postal_sector)")
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .returns<RawRow[]>();

    setOpenRequests((open ?? []).map((r) => toRow(r)));
    setLoading(false);
  }, [supabase, userId]);

  useEffect(() => {
    // Deferred so the initial setLoading(true) inside load() doesn't run
    // synchronously as part of the effect's own commit.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  useLiveRefresh([{ table: "pickup_requests" }], () => void load(true));

  function accept(requestId: string) {
    run(`${requestId}:accept`, async () => {
      setError(null);
      const { error: acceptError } = await supabase
        .from("pickup_requests")
        .update({ picker_id: userId, status: "accepted", accepted_at: new Date().toISOString() })
        .eq("id", requestId)
        .eq("status", "open"); // first to accept wins — a second picker's update matches 0 rows
      if (acceptError) {
        setError(acceptError.message);
        return;
      }
      await load(true);
    });
  }

  function completeHandoff() {
    if (!myPickup) return;
    const pickupId = myPickup.id;
    run(`${pickupId}:complete`, async () => {
      setError(null);
      const { error: completeError } = await supabase
        .from("pickup_requests")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", pickupId);
      if (completeError) {
        setError(completeError.message);
        return;
      }
      await load(true);
    });
  }

  return (
    <div className="mx-auto min-h-page max-w-md px-5 py-6" style={{ background: "var(--kb-navy)" }}>
      <TopBar badge="Picker" />

      {profile && (
        <div className="mt-4">
          <ProfileSummaryCard profile={profile} />
        </div>
      )}

      <h1 className="mt-4 font-display text-lg font-bold" style={{ color: "var(--kb-on-navy)" }}>
        Picker
      </h1>

      {error && (
        <p className="mt-2 rounded-xl px-3 py-2 text-xs" style={{ background: "rgba(239,68,68,0.15)", color: "#FCA5A5" }}>
          {error}
        </p>
      )}

      {myPickup ? (
        <div className="mt-4 rounded-2xl bg-white p-4" style={{ color: "var(--kb-ink)" }}>
          <p className="text-xs font-medium uppercase" style={{ color: "var(--kb-purple)" }}>
            Your active pickup
          </p>
          <p className="mt-1 text-sm font-semibold">{myPickup.kitchen_business_name}</p>
          <p className="text-xs" style={{ color: "var(--kb-ink-soft)" }}>{myPickup.kitchen_address}</p>
          {myPickup.kitchen_maps_url && (
            <a
              href={myPickup.kitchen_maps_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold"
              style={{ color: "var(--kb-purple)" }}
            >
              Open in Google Maps
            </a>
          )}
          <p className="mt-2 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
            Collect from the cook, meet the rider nearby, and get paid directly by the rider (suggested ${myPickup.suggested_fee.toFixed(2)}).
          </p>
          <button
            onClick={completeHandoff}
            disabled={busy}
            className="mt-3 w-full rounded-2xl py-3 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--kb-green-deep)" }}
          >
            <PendingLabel pending={isRunning(`${myPickup.id}:complete`)} pendingText="Completing…">Mark handoff complete</PendingLabel>
          </button>

          <PickupChat pickupRequestId={myPickup.id} userId={userId} as="picker" />
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm" style={{ color: "var(--kb-on-navy-soft)" }}>
            Nearby pickup requests from riders
          </p>

          {loading ? (
            <div className="mt-4">
              <SkeletonCards count={2} />
            </div>
          ) : openRequests.length === 0 ? (
            <p className="mt-4 rounded-2xl bg-white p-4 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
              No open requests right now — check back later.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {openRequests.map((r) => (
                <div key={r.id} className="rounded-2xl bg-white p-4" style={{ color: "var(--kb-ink)" }}>
                  <p className="text-sm font-semibold">{r.kitchen_business_name}</p>
                  <p className="text-xs" style={{ color: "var(--kb-ink-soft)" }}>{r.kitchen_address}</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                    Suggested ${r.suggested_fee.toFixed(2)} — paid directly by the rider
                  </p>
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
            className="mt-4 w-full rounded-2xl py-2.5 text-sm font-semibold disabled:opacity-60"
            style={{ background: "var(--kb-navy-raised)", color: "var(--kb-on-navy)" }}
          >
            <PendingLabel pending={isRunning("refresh")} pendingText="Refreshing…">Refresh</PendingLabel>
          </button>
        </>
      )}
    </div>
  );
}

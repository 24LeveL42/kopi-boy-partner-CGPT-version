"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { CircleMarker, Circle, Map as LeafletMap } from "leaflet";
import { createClient } from "@/lib/supabase/client";

interface RiderLiveLocation {
  delivery_request_id: string;
  rider_id: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  heading: number | null;
  updated_at: string;
}

// Older than this and the rider has stopped sharing (or lost signal / closed the app).
const STALE_MS = 2 * 60_000;
// Realtime doesn't deliver filtered DELETEs, so a slow re-read catches a rider
// switching sharing off.
const POLL_MS = 15_000;
// Leaflet draws paths as SVG attributes, which can't read CSS variables.
const PURPLE = "#7B3FE4";

function agoLabel(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ${s % 60}s ago`;
}

/**
 * Live map of the rider for one delivery. Rows only exist while the rider has
 * "Share my live location" on, and RLS limits them to the delivery's cook and
 * customer. Only the rider is drawn — never the kitchen.
 */
export function RiderLocationMap({ deliveryRequestId }: { deliveryRequestId: string }) {
  const [location, setLocation] = useState<RiderLiveLocation | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<CircleMarker | null>(null);
  const accuracyRef = useRef<Circle | null>(null);
  const locationRef = useRef<RiderLiveLocation | null>(null);
  useEffect(() => {
    locationRef.current = location;
  });

  // Load the row, then follow it over realtime (plus a slow poll).
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const fetchRow = async () => {
      const { data } = await supabase
        .from("rider_live_locations")
        .select("*")
        .eq("delivery_request_id", deliveryRequestId)
        .maybeSingle<RiderLiveLocation>();
      if (cancelled) return;
      setLocation(data ?? null);
      setLoaded(true);
    };

    const channel = supabase
      .channel(`rider-location:${deliveryRequestId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rider_live_locations", filter: `delivery_request_id=eq.${deliveryRequestId}` },
        (payload) => {
          if (payload.eventType === "DELETE") setLocation(null);
          else setLocation(payload.new as RiderLiveLocation);
        }
      )
      .subscribe();

    void fetchRow();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void fetchRow();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchRow();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [deliveryRequestId]);

  // Ticks the "updated Xs ago" label and the staleness check.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const updatedMs = location ? new Date(location.updated_at).getTime() : NaN;
  const live = location !== null && Number.isFinite(updatedMs) && now - updatedMs <= STALE_MS;

  // Create the map only while there's something live to show. Leaflet touches
  // `window` on import, so it's loaded here rather than at module level.
  useEffect(() => {
    if (!live || !containerRef.current) return;
    let disposed = false;

    void import("leaflet").then((L) => {
      const start = locationRef.current;
      if (disposed || !containerRef.current || !start) return;
      const pos: [number, number] = [Number(start.lat), Number(start.lng)];

      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView(pos, 16);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      accuracyRef.current = L.circle(pos, {
        radius: Number(start.accuracy_m ?? 0),
        color: PURPLE,
        weight: 1,
        fillColor: PURPLE,
        fillOpacity: 0.12,
      }).addTo(map);
      markerRef.current = L.circleMarker(pos, {
        radius: 9,
        color: "#FFFFFF",
        weight: 3,
        fillColor: PURPLE,
        fillOpacity: 1,
      })
        .bindTooltip("Rider")
        .addTo(map);
      mapRef.current = map;
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      accuracyRef.current = null;
    };
  }, [live]);

  // Move the pin as updates arrive.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !location) return;
    const pos: [number, number] = [Number(location.lat), Number(location.lng)];
    markerRef.current?.setLatLng(pos);
    accuracyRef.current?.setLatLng(pos).setRadius(Number(location.accuracy_m ?? 0));
    if (!map.getBounds().contains(pos)) map.panTo(pos);
  }, [location]);

  return (
    <div className="overflow-hidden rounded-2xl border bg-white" style={{ borderColor: "#E8DFFF", color: "var(--kb-ink)" }}>
      {!loaded ? (
        <p className="p-3 text-center text-xs" style={{ color: "var(--kb-ink-soft)" }}>Loading rider location…</p>
      ) : live ? (
        <>
          <div ref={containerRef} className="h-56 w-full sm:h-64" style={{ isolation: "isolate" }} aria-label="Map of the rider's live location" />
          <p className="flex items-center gap-2 px-3 py-2 text-xs font-semibold" style={{ color: "var(--kb-purple)" }}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: PURPLE }} />
            Rider location updated {agoLabel(now - updatedMs)}
          </p>
        </>
      ) : (
        <p className="p-3 text-center text-xs font-semibold" style={{ color: "var(--kb-ink-soft)" }}>
          Rider isn&apos;t sharing their location right now
        </p>
      )}
    </div>
  );
}

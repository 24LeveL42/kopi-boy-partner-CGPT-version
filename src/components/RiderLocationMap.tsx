"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import type { Marker, Circle, Polyline, Map as LeafletMap } from "leaflet";
import { createClient } from "@/lib/supabase/client";
import { dropoffIcon, riderIcon } from "@/lib/riderIcon";
import type { LatLngTuple } from "@/lib/rider-line";

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
const GREY = "#6B7280";

function lineStyle(stale: boolean) {
  return { color: stale ? GREY : PURPLE, weight: 2, opacity: stale ? 0.8 : 0.9, dashArray: "6 6", interactive: false };
}

// Same rule riderIcon uses to mirror the scooter (heading west).
function facesWest(heading: number | null) {
  return heading !== null && heading > 180 && heading < 360;
}

function agoLabel(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ${s % 60}s ago`;
}

/**
 * Live map of the rider for one delivery. Rows only exist while the rider has
 * "Share my live location" on, and RLS limits them to the delivery's cook and
 * customer. The kitchen is never drawn. After pickup the order card passes
 * `dropoff` (the customer's own orders.customer_lat/lng, via pickLineTarget)
 * and a dashed straight line runs from the rider to a drop-off pin; before
 * pickup it's null and only the rider shows.
 */
export function RiderLocationMap({
  deliveryRequestId,
  dropoff = null,
}: {
  deliveryRequestId: string;
  dropoff?: LatLngTuple | null;
}) {
  const [location, setLocation] = useState<RiderLiveLocation | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const accuracyRef = useRef<Circle | null>(null);
  const lineRef = useRef<Polyline | null>(null);
  const dropoffMarkerRef = useRef<Marker | null>(null);
  // Fit rider + drop-off into view once per map; after that only pan.
  const fittedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const dropLat = dropoff?.[0] ?? null;
  const dropLng = dropoff?.[1] ?? null;
  // "stale|west" for the icon currently on the marker, so it's only rebuilt
  // (restarting the pulse) when its look changes.
  const iconKeyRef = useRef("");
  const locationRef = useRef<RiderLiveLocation | null>(null);
  const staleRef = useRef(false);

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
  const stale = location !== null && !live;
  const hasRow = location !== null;
  useEffect(() => {
    locationRef.current = location;
    staleRef.current = stale;
  });

  // Create the map while there's a row to show, live or stale. Leaflet touches
  // `window` on import, so it's loaded here rather than at module level.
  useEffect(() => {
    if (!hasRow || !containerRef.current) return;
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
      const heading = start.heading === null ? null : Number(start.heading);
      const startStale = staleRef.current;
      iconKeyRef.current = `${startStale}|${facesWest(heading)}`;
      markerRef.current = L.marker(pos, {
        icon: riderIcon(L, { heading, stale: startStale }),
        keyboard: false,
        // Always above the drop-off pin.
        zIndexOffset: 1000,
      })
        .bindTooltip("Rider")
        .addTo(map);
      leafletRef.current = L;
      mapRef.current = map;
      setMapReady(true);
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      accuracyRef.current = null;
      lineRef.current = null;
      dropoffMarkerRef.current = null;
      fittedRef.current = false;
      iconKeyRef.current = "";
      setMapReady(false);
    };
  }, [hasRow]);

  // Move the pin (and refresh its heading / stale look) as updates arrive.
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L || !location) return;
    const pos: [number, number] = [Number(location.lat), Number(location.lng)];
    const heading = location.heading === null ? null : Number(location.heading);
    markerRef.current?.setLatLng(pos);
    const iconKey = `${stale}|${facesWest(heading)}`;
    if (iconKey !== iconKeyRef.current) {
      iconKeyRef.current = iconKey;
      markerRef.current?.setIcon(riderIcon(L, { heading, stale }));
    }
    accuracyRef.current?.setLatLng(pos).setRadius(Number(location.accuracy_m ?? 0));

    // Line + drop-off pin: added when pickup flips dropoff on (no map
    // rebuild), moved with the rider, removed if dropoff goes away.
    if (dropLat !== null && dropLng !== null) {
      const target: [number, number] = [dropLat, dropLng];
      if (lineRef.current) lineRef.current.setLatLngs([pos, target]).setStyle(lineStyle(stale));
      else lineRef.current = L.polyline([pos, target], lineStyle(stale)).addTo(map);
      if (dropoffMarkerRef.current) dropoffMarkerRef.current.setLatLng(target);
      else
        dropoffMarkerRef.current = L.marker(target, { icon: dropoffIcon(L), keyboard: false })
          .bindTooltip("Drop-off")
          .addTo(map);
      if (!fittedRef.current) {
        fittedRef.current = true;
        // Extra top-left room keeps the pin clear of the zoom buttons; bottom-right
        // clears the attribution.
        map.fitBounds(L.latLngBounds([pos, target]), {
          paddingTopLeft: [56, 40],
          paddingBottomRight: [32, 32],
          maxZoom: 17,
        });
        return;
      }
    } else {
      lineRef.current?.remove();
      lineRef.current = null;
      dropoffMarkerRef.current?.remove();
      dropoffMarkerRef.current = null;
    }
    if (!map.getBounds().contains(pos)) map.panTo(pos);
  }, [location, stale, mapReady, dropLat, dropLng]);

  return (
    <div className="overflow-hidden rounded-2xl border bg-white" style={{ borderColor: "#E8DFFF", color: "var(--kb-ink)" }}>
      {!loaded ? (
        <p className="p-3 text-center text-xs" style={{ color: "var(--kb-ink-soft)" }}>Loading rider location…</p>
      ) : hasRow ? (
        <>
          {stale && (
            <p className="px-3 py-2 text-xs font-semibold" style={{ background: "#FEF3C7", color: "#92400E" }}>
              Rider&apos;s location hasn&apos;t updated for {Math.max(2, Math.floor((now - updatedMs) / 60_000))} min. Last
              seen at the spot shown.
            </p>
          )}
          <div ref={containerRef} className="h-56 w-full sm:h-64" style={{ isolation: "isolate" }} aria-label="Map of the rider's live location" />
          <p
            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold"
            style={{ color: stale ? "var(--kb-ink-soft)" : "var(--kb-purple)" }}
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: stale ? "#9CA3AF" : PURPLE }} />
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

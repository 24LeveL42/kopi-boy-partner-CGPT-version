"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePendingAction } from "@/lib/use-pending-action";
import { PendingLabel } from "@/components/Pending";
import { keepScreenOn } from "@/lib/wake-lock";
import {
  LOCATION_CONSENT_VERSION,
  LocationReporter,
  MAP_SEND_MS,
  MapLocationWriter,
  SHARED_WITH_NOTE,
  SHARING_OFF_NOTE,
  SHARING_STATUS_TEXT,
  classifyReportError,
  consentStateFor,
  shouldAskConsent,
  shouldShare,
  toFix,
  type ConsentState,
  type SharingStatus,
} from "@/lib/rider-tracking";

// How often the HQ reporter checks whether it's time to send (it sends at most
// once per REPORT_INTERVAL_MS, and only to the server when that's due).
const TICK_MS = 5_000;

/**
 * The rider's one location control, on while they hold an accepted,
 * unfinished delivery and have agreed to the current consent version. One GPS
 * watch and one wake lock feed both Kopi Boy HQ (report_rider_location,
 * docs/supabase-rider-tracking.sql) and this delivery's cook/customer map
 * (the rider_live_locations row RiderLocationMap reads).
 *
 * Stops — removing the HQ live row with stop_rider_sharing and this
 * delivery's rider_live_locations row — when the job ends or is cancelled
 * (deliveryRequestId becomes null / this unmounts), the rider turns it off,
 * permission is refused, or the database says the rider is blocked.
 * SignOutButton removes both itself, while still signed in.
 */
export function RiderTrackingShare({ riderId, deliveryRequestId }: { riderId: string; deliveryRequestId: string | null }) {
  const [consent, setConsent] = useState<ConsentState>("loading");
  const [blocked, setBlocked] = useState(false);
  // Job id the rider said "Not now" / "Turn off" for; a new job asks again.
  const [offForJob, setOffForJob] = useState<string | null>(null);
  const [locationProblem, setLocationProblem] = useState<string | null>(null);
  // The cook/customer map write failed; HQ reporting carries on.
  const [mapProblem, setMapProblem] = useState<string | null>(null);
  // Bumped by "Try again" to restart the watch (and with it the map writes).
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<SharingStatus>("waiting-permission");
  const turnedOffForJob = deliveryRequestId !== null && offForJob === deliveryRequestId;

  useEffect(() => {
    let live = true;
    createClient()
      .from("rider_location_consent")
      .select("consent_version")
      .eq("rider_id", riderId)
      .maybeSingle<{ consent_version: string }>()
      .then(({ data, error }) => {
        if (live) setConsent(error ? "error" : consentStateFor(data));
      });
    return () => {
      live = false;
    };
  }, [riderId]);

  const sharing = shouldShare({ deliveryRequestId, consent, blocked, turnedOffForJob, locationUnavailable: locationProblem !== null });

  useEffect(() => {
    if (!sharing || !deliveryRequestId) return;
    const supabase = createClient();
    let stopped = false;

    if (!("geolocation" in navigator)) {
      // Deferred: setState can't run synchronously inside the effect.
      queueMicrotask(() => {
        if (!stopped) setLocationProblem("This browser can't share your location.");
      });
      return () => {
        stopped = true;
      };
    }

    const reporter = new LocationReporter({
      now: () => Date.now(),
      isOnline: () => navigator.onLine,
      send: async (fix) => {
        const { data, error } = await supabase.rpc("report_rider_location", {
          p_lat: fix.lat,
          p_lng: fix.lng,
          p_accuracy_m: fix.accuracy,
          p_heading: fix.heading,
          p_speed_mps: fix.speed,
          p_delivery_request_id: deliveryRequestId,
        });
        if (error) return classifyReportError(error);
        return data === false ? "skipped" : "sent";
      },
      onStatus: (s) => {
        if (!stopped) setStatus(s);
      },
      onFatal: (outcome) => {
        if (stopped) return;
        if (outcome === "blocked") setBlocked(true);
        else if (outcome === "no-consent") setConsent("missing");
        // job-ended: the panel's live refresh drops the job, which unmounts this.
        else setOffForJob(deliveryRequestId);
      },
    });

    const mapWriter = new MapLocationWriter({
      now: () => Date.now(),
      upsert: async (row) => {
        const { error } = await supabase
          .from("rider_live_locations")
          .upsert({ delivery_request_id: deliveryRequestId, rider_id: riderId, ...row }, { onConflict: "delivery_request_id" });
        return error ? error.message : null;
      },
      remove: () =>
        supabase
          .from("rider_live_locations")
          .delete()
          .eq("delivery_request_id", deliveryRequestId)
          .eq("rider_id", riderId)
          .then(() => {}, () => {}),
      onError: (message) => {
        if (!stopped) setMapProblem(`The cook and customer can't see your location right now: ${message}`);
      },
    });

    // Until the first fix: "waiting for permission" unless already granted.
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((p) => {
        if (!stopped && p.state === "granted") setStatus((s) => (s === "waiting-permission" ? "no-gps" : s));
      })
      .catch(() => {});

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const fix = toFix(position.coords, position.timestamp);
        void reporter.update(fix);
        void mapWriter.update(fix);
      },
      (err) => {
        if (stopped) return;
        if (err.code === err.PERMISSION_DENIED) {
          setLocationProblem("Location permission is blocked. Allow location for this site in your browser settings, then tap Try again.");
        } else {
          // No fix right now; the watch keeps going and recovers on its own.
          setStatus("no-gps");
        }
      },
      { enableHighAccuracy: true, maximumAge: 5_000 }
    );
    const timer = setInterval(() => void reporter.tick(), TICK_MS);
    // GPS may not report while standing still; resend the last fix so the cook
    // and customer don't see the location go stale.
    const mapHeartbeat = setInterval(() => void mapWriter.tick(), MAP_SEND_MS);
    const onOnline = () => void reporter.tick();
    window.addEventListener("online", onOnline);
    const releaseScreen = keepScreenOn();

    return () => {
      stopped = true;
      reporter.stop();
      mapWriter.stop();
      navigator.geolocation.clearWatch(watchId);
      clearInterval(timer);
      clearInterval(mapHeartbeat);
      window.removeEventListener("online", onOnline);
      releaseScreen();
      // After any call still in flight, so it can't re-create the row.
      void reporter.settled().then(() => supabase.rpc("stop_rider_sharing").then(() => {}, () => {}));
    };
  }, [sharing, deliveryRequestId, riderId, attempt]);

  // No job (none on load, or the last one just finished): make sure nothing is
  // left on the HQ map from an earlier session that ended without cleaning up.
  useEffect(() => {
    if (deliveryRequestId === null && consent === "given") {
      void createClient().rpc("stop_rider_sharing").then(() => {}, () => {});
    }
  }, [deliveryRequestId, consent]);

  if (deliveryRequestId === null) {
    return (
      <p className="mb-3 text-[11px]" style={{ color: "var(--kb-ink-soft)" }}>
        {SHARING_STATUS_TEXT.off}. It only turns on while you have a job.
      </p>
    );
  }

  if (shouldAskConsent({ deliveryRequestId, consent, blocked, turnedOffForJob })) {
    return (
      <LocationConsent
        onAgreed={() => {
          setConsent("given");
          setStatus("waiting-permission");
        }}
        onNotNow={() => setOffForJob(deliveryRequestId)}
      />
    );
  }

  const shown: SharingStatus = sharing ? status : "off";
  const dot = shown === "on" ? "var(--kb-green-deep)" : shown === "off" ? "#9A97A3" : "#C77700";
  const problem = blocked ? null : (locationProblem ?? (sharing ? mapProblem : null));

  function turnOn() {
    setLocationProblem(null);
    setMapProblem(null);
    setStatus("waiting-permission");
    setOffForJob(null);
    // Still sharing with HQ (only the map write failed): restart the watch.
    if (sharing) setAttempt((n) => n + 1);
  }

  return (
    <div className="mt-3 rounded-2xl border p-3" style={{ borderColor: "#E8DFFF", background: "#FFFFFF" }}>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--kb-ink)" }} role="status">
          <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dot }} aria-hidden="true" />
          {SHARING_STATUS_TEXT[shown]}
        </p>
        {!blocked && consent !== "loading" && consent !== "error" && (
          <button
            type="button"
            onClick={sharing && !problem ? () => setOffForJob(deliveryRequestId) : turnOn}
            className="shrink-0 text-xs font-semibold"
            style={{ color: "var(--kb-purple)" }}
          >
            {problem ? "Try again" : sharing ? "Turn off" : "Turn on"}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
        {blocked
          ? "Your account is blocked."
          : consent === "error"
            ? "Couldn't check your location settings. Reload the page to try again."
            : sharing
              ? SHARED_WITH_NOTE
              : SHARING_OFF_NOTE}
      </p>
      {problem && (
        <p className="mt-2 rounded-xl px-3 py-2 text-xs" style={{ background: "#FEF0F0", color: "#B42318" }}>
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * PLACEHOLDER WORDING — NEEDS LAWYER REVIEW before launch. Plain-English
 * summary only; not legal text. When it changes, bump
 * LOCATION_CONSENT_VERSION (src/lib/rider-tracking.ts) so riders agree again.
 */
function LocationConsent({ onAgreed, onNotNow }: { onAgreed: () => void; onNotNow: () => void }) {
  const [months, setMonths] = useState<number | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = usePendingAction();

  // How long it's kept comes from the database (location_retention_months),
  // never a number in this file.
  useEffect(() => {
    let live = true;
    createClient()
      .rpc("location_retention_months")
      .then(({ data, error }) => {
        if (!live) return;
        if (error || typeof data !== "number") setLoadFailed(true);
        else setMonths(data);
      });
    return () => {
      live = false;
    };
  }, []);

  function agree() {
    run("location-consent", async () => {
      setError(null);
      const { error } = await createClient().rpc("record_rider_location_consent", { p_version: LOCATION_CONSENT_VERSION });
      if (error) {
        setError(error.message === "Only riders can do this." ? error.message : "Couldn't save that. Please try again.");
        return;
      }
      onAgreed();
    });
  }

  return (
    <div className="mt-3 rounded-2xl p-4" style={{ background: "var(--kb-cream)", color: "var(--kb-ink)" }}>
      <p className="text-sm font-bold">Share your location during deliveries?</p>
      <ul className="mt-2 space-y-1.5 text-xs">
        <li><strong>What:</strong> your location (where your phone is).</li>
        <li><strong>When:</strong> only while you have an accepted delivery that isn&apos;t finished yet.</li>
        <li>
          <strong>Who can see it:</strong> Kopi Boy admin, and the cook and the customer of your delivery on their
          delivery map.
        </li>
        <li>
          <strong>How long we keep it:</strong>{" "}
          {months !== null ? `${months} months.` : loadFailed ? "couldn't load — please try again later." : "…"}
        </li>
        <li>
          <strong>Switching it off:</strong> tap &quot;Turn off&quot; on your delivery. It also stops by itself when the
          delivery is finished or cancelled, or when you sign out.
        </li>
      </ul>
      {error && (
        <p className="mt-2 rounded-xl px-3 py-2 text-xs" style={{ background: "#FEF0F0", color: "#B42318" }}>
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={agree}
        disabled={busy || months === null}
        className="kb-btn-primary mt-3 w-full py-3 text-sm disabled:opacity-60"
      >
        <PendingLabel pending={busy} pendingText="Saving…">I agree</PendingLabel>
      </button>
      <button
        type="button"
        onClick={onNotNow}
        disabled={busy}
        className="mt-2 w-full text-xs font-semibold disabled:opacity-60"
        style={{ color: "var(--kb-ink-soft)" }}
      >
        Not now
      </button>
    </div>
  );
}

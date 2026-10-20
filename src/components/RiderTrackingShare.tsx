"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePendingAction } from "@/lib/use-pending-action";
import { PendingLabel } from "@/components/Pending";
import { keepScreenOn } from "@/lib/wake-lock";
import {
  LOCATION_CONSENT_VERSION,
  LocationReporter,
  SHARING_STATUS_TEXT,
  classifyReportError,
  consentStateFor,
  shouldAskConsent,
  shouldShare,
  toFix,
  type ConsentState,
  type SharingStatus,
} from "@/lib/rider-tracking";

// How often the reporter checks whether it's time to send (it sends at most
// once per REPORT_INTERVAL_MS, and only to the server when that's due).
const TICK_MS = 5_000;

/**
 * Location sharing with Kopi Boy HQ (docs/supabase-rider-tracking.sql), on
 * while the rider holds an accepted, unfinished delivery and has agreed to the
 * current consent version. Separate from RiderLocationShare (the opt-in switch
 * that shows the rider to this order's cook and customer).
 *
 * Stops — and removes the rider's live row with stop_rider_sharing — when the
 * job ends (deliveryRequestId becomes null / this unmounts), the rider turns
 * it off, permission is refused, or the database says the rider is blocked.
 * SignOutButton calls stop_rider_sharing itself, while still signed in.
 */
export function RiderTrackingShare({ riderId, deliveryRequestId }: { riderId: string; deliveryRequestId: string | null }) {
  const [consent, setConsent] = useState<ConsentState>("loading");
  const [blocked, setBlocked] = useState(false);
  // Job id the rider said "Not now" / "Turn off" for; a new job asks again.
  const [offForJob, setOffForJob] = useState<string | null>(null);
  const [locationProblem, setLocationProblem] = useState<string | null>(null);
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

    // Until the first fix: "waiting for permission" unless already granted.
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((p) => {
        if (!stopped && p.state === "granted") setStatus((s) => (s === "waiting-permission" ? "no-gps" : s));
      })
      .catch(() => {});

    const watchId = navigator.geolocation.watchPosition(
      (position) => void reporter.update(toFix(position.coords, position.timestamp)),
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
    const onOnline = () => void reporter.tick();
    window.addEventListener("online", onOnline);
    const releaseScreen = keepScreenOn();

    return () => {
      stopped = true;
      reporter.stop();
      navigator.geolocation.clearWatch(watchId);
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
      releaseScreen();
      // After any call still in flight, so it can't re-create the row.
      void reporter.settled().then(() => supabase.rpc("stop_rider_sharing").then(() => {}, () => {}));
    };
  }, [sharing, deliveryRequestId]);

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

  function turnOn() {
    setLocationProblem(null);
    setStatus("waiting-permission");
    setOffForJob(null);
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
            onClick={sharing ? () => setOffForJob(deliveryRequestId) : turnOn}
            className="shrink-0 text-xs font-semibold"
            style={{ color: "var(--kb-purple)" }}
          >
            {sharing ? "Turn off" : locationProblem ? "Try again" : "Turn on"}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
        {blocked
          ? "Your account is blocked."
          : consent === "error"
            ? "Couldn't check your location settings. Reload the page to try again."
            : sharing
              ? "Shared with Kopi Boy admin only. Keep this app open on this screen during the job."
              : "Kopi Boy admin can't see your location for this job."}
      </p>
      {locationProblem && !blocked && (
        <p className="mt-2 rounded-xl px-3 py-2 text-xs" style={{ background: "#FEF0F0", color: "#B42318" }}>
          {locationProblem}
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
      <p className="text-sm font-bold">Share your location with Kopi Boy?</p>
      <ul className="mt-2 space-y-1.5 text-xs">
        <li><strong>What:</strong> your location (where your phone is).</li>
        <li><strong>When:</strong> only while you have a job in this app.</li>
        <li><strong>Who can see it:</strong> Kopi Boy admin only.</li>
        <li>
          <strong>How long we keep it:</strong>{" "}
          {months !== null ? `${months} months.` : loadFailed ? "couldn't load — please try again later." : "…"}
        </li>
        <li><strong>Switching it off:</strong> tap &quot;Turn off&quot; on your job. It also stops by itself when the job is finished.</li>
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

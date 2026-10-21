/**
 * Rider location sharing: the start/stop rules behind RiderTrackingShare, the
 * throttled, backed-off reporter for Kopi Boy HQ (report_rider_location,
 * docs/supabase-rider-tracking.sql) and the writer for the cook/customer
 * delivery map (rider_live_locations). One consent and one GPS watch feed
 * both. Kept free of React, Next.js and Supabase imports so it can be tested
 * with fakes.
 *
 * Riders have no online/offline switch (notification_preferences.on_duty only
 * mutes new-request alerts), so "on duty" here means: holding an accepted,
 * unfinished delivery.
 */

/**
 * Stored by record_rider_location_consent(). Bump it whenever the consent
 * wording in RiderTrackingShare changes — riders who agreed to an older
 * version are asked again.
 */
export const LOCATION_CONSENT_VERSION = "2026-10-v2";

/** At most one rider_live_locations write (cook/customer map) this often. */
export const MAP_SEND_MS = 10_000;
/** At most one report_rider_location call this often. */
export const REPORT_INTERVAL_MS = 15_000;
/** Longest wait between retries after network/server failures. */
export const MAX_BACKOFF_MS = 5 * 60_000;
/** A fix older than this isn't sent again: the rider has no GPS signal. */
export const STALE_FIX_MS = 60_000;

export type ConsentState = "loading" | "given" | "missing" | "error";

/** What the database has for this rider, if anything. */
export function consentStateFor(row: { consent_version: string } | null): ConsentState {
  return row?.consent_version === LOCATION_CONSENT_VERSION ? "given" : "missing";
}

export interface ShareInputs {
  /** The rider's accepted, unfinished delivery, if they have one. */
  deliveryRequestId: string | null;
  consent: ConsentState;
  blocked: boolean;
  /** The rider tapped "Not now" / "Turn off" for this job. */
  turnedOffForJob: boolean;
  /** The browser refused location (or has none). */
  locationUnavailable: boolean;
}

/** Whether to watch GPS and report right now. */
export function shouldShare(i: ShareInputs): boolean {
  return (
    i.deliveryRequestId !== null &&
    i.consent === "given" &&
    !i.blocked &&
    !i.turnedOffForJob &&
    !i.locationUnavailable
  );
}

/** Whether to show the consent screen right now. */
export function shouldAskConsent(i: Pick<ShareInputs, "deliveryRequestId" | "consent" | "blocked" | "turnedOffForJob">): boolean {
  return i.deliveryRequestId !== null && i.consent === "missing" && !i.blocked && !i.turnedOffForJob;
}

export type SharingStatus = "on" | "off" | "waiting-permission" | "no-gps" | "no-network";

export const SHARING_STATUS_TEXT: Record<SharingStatus, string> = {
  on: "Location sharing is on",
  off: "Location sharing is off",
  "waiting-permission": "Location sharing is waiting for permission",
  "no-gps": "Location sharing: no GPS signal",
  "no-network": "Location sharing: no internet — will retry",
};

/** Under the status line while sharing. */
export const SHARED_WITH_NOTE = "Shared with Kopi Boy, the cook and the customer during this delivery";
/** On a job without sharing ("Not now", "Turn off", permission refused). */
export const SHARING_OFF_NOTE = "Location sharing is off. The customer and cook will not see your location.";

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  /** When the fix was taken, ms since epoch. */
  at: number;
}

const finiteOrNull = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : null);

/** GeolocationPosition -> Fix (browsers send null/NaN for heading and speed). */
export function toFix(
  coords: { latitude: number; longitude: number; accuracy: number; heading: number | null; speed: number | null },
  at: number
): Fix {
  return {
    lat: coords.latitude,
    lng: coords.longitude,
    accuracy: finiteOrNull(coords.accuracy),
    heading: finiteOrNull(coords.heading),
    speed: finiteOrNull(coords.speed),
    at,
  };
}

/**
 * How one report_rider_location call went:
 *   sent / skipped — saved, or dropped by the database's own 10-second rule;
 *   rejected       — the point itself was refused (outside Singapore): wait
 *                    the normal interval and send the next one;
 *   network        — no answer / server trouble: back off and retry;
 *   blocked, no-consent, job-ended — stop reporting.
 */
export type ReportOutcome = "sent" | "skipped" | "rejected" | "network" | "blocked" | "no-consent" | "job-ended";
export type FatalOutcome = Extract<ReportOutcome, "blocked" | "no-consent" | "job-ended">;

/** Maps an RPC error to an outcome, by the messages/codes the SQL raises. */
export function classifyReportError(error: { message?: string; code?: string }): ReportOutcome {
  if (error.message === "Your account is blocked." || error.message === "Only riders can do this.") return "blocked";
  if (error.message === "Please agree to location sharing first.") return "no-consent";
  if (error.code === "P0002") return "job-ended";
  if (error.code === "22023") return "rejected";
  return "network";
}

/** Wait after `failures` failed attempts in a row: 30s, 60s, 120s, … capped. */
export function backoffMs(failures: number): number {
  return Math.min(REPORT_INTERVAL_MS * 2 ** failures, MAX_BACKOFF_MS);
}

export interface ReporterOptions {
  send(fix: Fix): Promise<ReportOutcome>;
  now(): number;
  /** false = don't even try (navigator.onLine). */
  isOnline(): boolean;
  onStatus(status: SharingStatus): void;
  onFatal(outcome: FatalOutcome): void;
}

/**
 * Holds the latest GPS fix and sends it at most once per REPORT_INTERVAL_MS.
 * Call update() on every fix and tick() on a timer (it resends the latest fix
 * while it's fresh, so a rider standing still stays visible). One call at a
 * time; failures back off; a fatal outcome stops it for good.
 */
export class LocationReporter {
  private latest: Fix | null = null;
  private nextAt = 0;
  private failures = 0;
  private stopped = false;
  private inFlight: Promise<void> | null = null;
  private readonly opts: ReporterOptions;

  constructor(opts: ReporterOptions) {
    this.opts = opts;
  }

  update(fix: Fix): Promise<void> {
    this.latest = fix;
    return this.tick();
  }

  tick(): Promise<void> {
    if (this.stopped || this.inFlight || !this.latest) return Promise.resolve();
    const now = this.opts.now();
    if (now - this.latest.at > STALE_FIX_MS) {
      this.opts.onStatus("no-gps");
      return Promise.resolve();
    }
    if (now < this.nextAt) return Promise.resolve();
    if (!this.opts.isOnline()) {
      this.opts.onStatus("no-network");
      return Promise.resolve();
    }
    const fix = this.latest;
    this.inFlight = this.opts
      .send(fix)
      .catch((): ReportOutcome => "network")
      .then((outcome) => {
        this.inFlight = null;
        if (this.stopped) return;
        this.handle(outcome, now);
      });
    return this.inFlight;
  }

  private handle(outcome: ReportOutcome, startedAt: number) {
    switch (outcome) {
      case "sent":
      case "skipped":
      case "rejected":
        this.failures = 0;
        this.nextAt = startedAt + REPORT_INTERVAL_MS;
        this.opts.onStatus("on");
        return;
      case "network":
        this.failures += 1;
        this.nextAt = startedAt + backoffMs(this.failures);
        this.opts.onStatus("no-network");
        return;
      default:
        this.stopped = true;
        this.opts.onFatal(outcome);
    }
  }

  /** No more sends. A call already in flight still finishes — see settled(). */
  stop() {
    this.stopped = true;
  }

  /** Resolves once no call is in flight. */
  settled(): Promise<void> {
    return this.inFlight ?? Promise.resolve();
  }
}

/** One rider_live_locations row, as the cook's and customer's map reads it. */
export interface MapRow {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  heading: number | null;
  updated_at: string;
}

export interface MapWriterOptions {
  /** Upsert this delivery's row; resolves with the error message, if any. */
  upsert(row: MapRow): Promise<string | null>;
  /** Delete this delivery's row. */
  remove(): PromiseLike<unknown>;
  now(): number;
  /** The write failed: writing has stopped and the row is being removed. */
  onError(message: string): void;
}

/**
 * Keeps this delivery's rider_live_locations row (the cook's and customer's
 * map) on the latest fix: at most one write per MAP_SEND_MS, one at a time,
 * and tick() resends the last fix so a rider standing still doesn't go stale.
 * stop() deletes the row; a write that lands after it deletes again. A failed
 * write stops it and deletes the row.
 */
export class MapLocationWriter {
  private latest: Fix | null = null;
  private lastSent = 0;
  private inFlight = false;
  private stopped = false;
  private readonly opts: MapWriterOptions;

  constructor(opts: MapWriterOptions) {
    this.opts = opts;
  }

  update(fix: Fix): Promise<void> {
    this.latest = fix;
    return this.tick();
  }

  async tick(): Promise<void> {
    if (this.stopped || this.inFlight || !this.latest || this.opts.now() - this.lastSent < MAP_SEND_MS) return;
    this.inFlight = true;
    this.lastSent = this.opts.now();
    const fix = this.latest;
    const error = await this.opts
      .upsert({
        lat: fix.lat,
        lng: fix.lng,
        accuracy_m: fix.accuracy,
        heading: fix.heading,
        updated_at: new Date(this.lastSent).toISOString(),
      })
      .catch((e: unknown) => (e instanceof Error ? e.message : "network error"));
    this.inFlight = false;
    // Stopped while this write was in flight — it may have landed after
    // stop()'s delete, so delete again.
    if (this.stopped) {
      void this.opts.remove();
      return;
    }
    if (error) {
      this.stop();
      this.opts.onError(error);
    }
  }

  /** No more writes; deletes the row. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    void this.opts.remove();
  }
}

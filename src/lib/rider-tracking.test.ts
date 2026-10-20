import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LocationReporter,
  LOCATION_CONSENT_VERSION,
  MAX_BACKOFF_MS,
  REPORT_INTERVAL_MS,
  STALE_FIX_MS,
  backoffMs,
  classifyReportError,
  consentStateFor,
  shouldAskConsent,
  shouldShare,
  toFix,
  type Fix,
  type ReportOutcome,
  type ShareInputs,
  type SharingStatus,
} from "./rider-tracking.ts";

const JOB = "job-1";
const BASE: ShareInputs = {
  deliveryRequestId: JOB,
  consent: "given",
  blocked: false,
  turnedOffForJob: false,
  locationUnavailable: false,
};

describe("shouldShare (start/stop rules)", () => {
  it("shares with an accepted job and current consent", () => {
    assert.equal(shouldShare(BASE), true);
  });

  it("stops when the job is finished (no accepted job)", () => {
    assert.equal(shouldShare({ ...BASE, deliveryRequestId: null }), false);
  });

  it("never shares without consent, or while consent is loading/failed", () => {
    for (const consent of ["missing", "loading", "error"] as const) {
      assert.equal(shouldShare({ ...BASE, consent }), false, consent);
    }
  });

  it("stops when blocked, turned off for the job, or location is unavailable", () => {
    assert.equal(shouldShare({ ...BASE, blocked: true }), false);
    assert.equal(shouldShare({ ...BASE, turnedOffForJob: true }), false);
    assert.equal(shouldShare({ ...BASE, locationUnavailable: true }), false);
  });
});

describe("shouldAskConsent", () => {
  const ask = { deliveryRequestId: JOB, consent: "missing" as const, blocked: false, turnedOffForJob: false };

  it("asks on a job when consent is missing", () => {
    assert.equal(shouldAskConsent(ask), true);
  });

  it("doesn't ask without a job, after 'Not now', when blocked, or once given", () => {
    assert.equal(shouldAskConsent({ ...ask, deliveryRequestId: null }), false);
    assert.equal(shouldAskConsent({ ...ask, turnedOffForJob: true }), false);
    assert.equal(shouldAskConsent({ ...ask, blocked: true }), false);
    assert.equal(shouldAskConsent({ ...ask, consent: "given" }), false);
    assert.equal(shouldAskConsent({ ...ask, consent: "loading" }), false);
  });
});

describe("consentStateFor", () => {
  it("only the current version counts as given", () => {
    assert.equal(consentStateFor({ consent_version: LOCATION_CONSENT_VERSION }), "given");
    assert.equal(consentStateFor({ consent_version: "2020-01-v0" }), "missing");
    assert.equal(consentStateFor(null), "missing");
  });
});

describe("classifyReportError", () => {
  it("maps the SQL's errors", () => {
    assert.equal(classifyReportError({ message: "Your account is blocked.", code: "42501" }), "blocked");
    assert.equal(classifyReportError({ message: "Only riders can do this.", code: "42501" }), "blocked");
    assert.equal(classifyReportError({ message: "Please agree to location sharing first.", code: "42501" }), "no-consent");
    assert.equal(classifyReportError({ message: "This delivery is no longer active.", code: "P0002" }), "job-ended");
    assert.equal(classifyReportError({ message: "That location is outside Singapore.", code: "22023" }), "rejected");
    assert.equal(classifyReportError({ message: "TypeError: Failed to fetch", code: "" }), "network");
  });
});

describe("toFix", () => {
  it("turns NaN/null heading and speed into null", () => {
    const fix = toFix({ latitude: 1.35, longitude: 103.8, accuracy: 12, heading: NaN, speed: null }, 5);
    assert.deepEqual(fix, { lat: 1.35, lng: 103.8, accuracy: 12, heading: null, speed: null, at: 5 });
  });
});

describe("backoffMs", () => {
  it("doubles from twice the interval and caps", () => {
    assert.equal(backoffMs(1), 2 * REPORT_INTERVAL_MS);
    assert.equal(backoffMs(2), 4 * REPORT_INTERVAL_MS);
    assert.equal(backoffMs(50), MAX_BACKOFF_MS);
  });
});

/** A reporter on a fake clock whose send() answers from a queue. */
function harness({ outcomes = [] as ReportOutcome[], online = true } = {}) {
  let clock = 1_000_000;
  const sent: Fix[] = [];
  const statuses: SharingStatus[] = [];
  const fatal: string[] = [];
  const state = { online };
  const reporter = new LocationReporter({
    now: () => clock,
    isOnline: () => state.online,
    send: async (fix) => {
      sent.push(fix);
      return outcomes.shift() ?? "sent";
    },
    onStatus: (s) => statuses.push(s),
    onFatal: (o) => fatal.push(o),
  });
  const fix = (): Fix => ({ lat: 1.35, lng: 103.8, accuracy: 10, heading: null, speed: null, at: clock });
  return {
    reporter,
    sent,
    statuses,
    fatal,
    state,
    fix,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("LocationReporter throttling", () => {
  it("sends the first fix, then at most once per interval", async () => {
    const h = harness();
    await h.reporter.update(h.fix());
    h.advance(5_000);
    await h.reporter.update(h.fix());
    h.advance(5_000);
    await h.reporter.tick();
    assert.equal(h.sent.length, 1);

    h.advance(REPORT_INTERVAL_MS - 10_000);
    await h.reporter.tick();
    assert.equal(h.sent.length, 2);
    assert.equal(h.statuses.at(-1), "on");
  });

  it("never runs two calls at once", async () => {
    let release!: () => void;
    let calls = 0;
    let clock = 0;
    const reporter = new LocationReporter({
      now: () => clock,
      isOnline: () => true,
      send: () => {
        calls += 1;
        return new Promise<ReportOutcome>((resolve) => {
          release = () => resolve("sent");
        });
      },
      onStatus: () => {},
      onFatal: () => {},
    });
    const fix = { lat: 1.35, lng: 103.8, accuracy: null, heading: null, speed: null, at: 0 };
    const first = reporter.update(fix);
    clock = REPORT_INTERVAL_MS * 10;
    await reporter.update({ ...fix, at: clock });
    assert.equal(calls, 1);
    release();
    await first;
    await reporter.settled();
  });

  it("treats the database's own skip as success", async () => {
    const h = harness({ outcomes: ["skipped"] });
    await h.reporter.update(h.fix());
    assert.deepEqual(h.statuses, ["on"]);
    h.advance(REPORT_INTERVAL_MS);
    await h.reporter.update(h.fix());
    assert.equal(h.sent.length, 2);
  });

  it("doesn't resend a stale fix and reports no GPS", async () => {
    const h = harness();
    await h.reporter.update(h.fix());
    h.advance(STALE_FIX_MS + 1);
    await h.reporter.tick();
    assert.equal(h.sent.length, 1);
    assert.equal(h.statuses.at(-1), "no-gps");
  });
});

describe("LocationReporter failures", () => {
  it("backs off after network failures and resets on success", async () => {
    const h = harness({ outcomes: ["network", "network", "sent"] });
    await h.reporter.update(h.fix());
    assert.equal(h.statuses.at(-1), "no-network");

    // Normal interval isn't enough after a failure.
    h.advance(REPORT_INTERVAL_MS);
    await h.reporter.update(h.fix());
    assert.equal(h.sent.length, 1);

    h.advance(backoffMs(1) - REPORT_INTERVAL_MS);
    await h.reporter.update(h.fix());
    assert.equal(h.sent.length, 2);

    h.advance(backoffMs(2) - 1);
    await h.reporter.update(h.fix());
    assert.equal(h.sent.length, 2);
    h.advance(1);
    await h.reporter.update(h.fix());
    assert.equal(h.sent.length, 3);
    assert.equal(h.statuses.at(-1), "on");

    h.advance(REPORT_INTERVAL_MS);
    await h.reporter.update(h.fix());
    assert.equal(h.sent.length, 4);
  });

  it("a thrown send counts as a network failure", async () => {
    const statuses: SharingStatus[] = [];
    const reporter = new LocationReporter({
      now: () => 0,
      isOnline: () => true,
      send: async () => {
        throw new Error("offline");
      },
      onStatus: (s) => statuses.push(s),
      onFatal: () => assert.fail("not fatal"),
    });
    await reporter.update({ lat: 1.35, lng: 103.8, accuracy: null, heading: null, speed: null, at: 0 });
    assert.deepEqual(statuses, ["no-network"]);
  });

  it("doesn't call the server while the browser is offline", async () => {
    const h = harness({ online: false });
    await h.reporter.update(h.fix());
    await h.reporter.tick();
    assert.equal(h.sent.length, 0);
    assert.equal(h.statuses.at(-1), "no-network");

    h.state.online = true;
    await h.reporter.tick();
    assert.equal(h.sent.length, 1);
  });

  for (const outcome of ["blocked", "no-consent", "job-ended"] as const) {
    it(`stops for good on ${outcome}`, async () => {
      const h = harness({ outcomes: [outcome] });
      await h.reporter.update(h.fix());
      assert.deepEqual(h.fatal, [outcome]);
      h.advance(REPORT_INTERVAL_MS * 10);
      await h.reporter.update(h.fix());
      assert.equal(h.sent.length, 1);
    });
  }

  it("sends nothing after stop()", async () => {
    const h = harness();
    h.reporter.stop();
    await h.reporter.update(h.fix());
    assert.equal(h.sent.length, 0);
  });
});

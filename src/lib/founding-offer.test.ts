import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { claimOfferShow, msUntilNextSgMidnight, OFFER_SEEN_KEY, offerPhase, resetOfferPageLoadForTests } from "./founding-offer.ts";
import { FOUNDING_OFFER_COPY, FOUNDING_OFFER_ENDS_AT } from "./onboarding-copy.ts";

const at = (iso: string) => offerPhase(new Date(iso));

describe("offer countdown (Singapore time)", () => {
  it("the switch is 22 Dec 2026, midnight Singapore time", () => {
    assert.equal(FOUNDING_OFFER_ENDS_AT, "2026-12-22T00:00:00+08:00");
  });

  it("33 days left on 19 Nov 2026, all day long", () => {
    for (const t of ["2026-11-19T00:00:00+08:00", "2026-11-19T12:00:00+08:00", "2026-11-19T23:59:59+08:00"]) {
      assert.deepEqual(at(t), { kind: "offer", countdown: "33 days left" }, t);
    }
  });

  it("follows Singapore's day, not the device's: 18 Nov 17:00 UTC is already 19 Nov in Singapore", () => {
    assert.deepEqual(at("2026-11-18T16:00:00Z"), { kind: "offer", countdown: "33 days left" });
    assert.deepEqual(at("2026-11-18T15:59:59Z"), { kind: "offer", countdown: "34 days left" });
  });

  it("2 days left on 20 Dec, right up to the last day", () => {
    assert.deepEqual(at("2026-12-20T00:00:00+08:00"), { kind: "offer", countdown: "2 days left" });
    assert.deepEqual(at("2026-12-20T23:59:59+08:00"), { kind: "offer", countdown: "2 days left" });
  });

  it('"Last day to join" all of 21 Dec', () => {
    assert.deepEqual(at("2026-12-21T00:00:00+08:00"), { kind: "offer", countdown: "Last day to join" });
    assert.deepEqual(at("2026-12-21T23:59:59.999+08:00"), { kind: "offer", countdown: "Last day to join" });
  });

  it("neutral from 22 Dec 00:00 +08:00", () => {
    assert.deepEqual(at("2026-12-22T00:00:00+08:00"), { kind: "neutral" });
    assert.deepEqual(at("2026-12-21T16:00:00Z"), { kind: "neutral" });
    assert.deepEqual(at("2027-06-01T09:00:00+08:00"), { kind: "neutral" });
    assert.deepEqual(at("invalid"), { kind: "neutral" });
  });

  it('says "1 day left", singular', () => {
    assert.equal(FOUNDING_OFFER_COPY.daysLeft(1), "1 day left");
    assert.equal(FOUNDING_OFFER_COPY.daysLeft(2), "2 days left");
  });

  it("next refresh is at the next Singapore midnight", () => {
    assert.equal(msUntilNextSgMidnight(new Date("2026-12-20T23:00:00+08:00")), 60 * 60 * 1000);
    assert.equal(msUntilNextSgMidnight(new Date("2026-12-21T00:00:00+08:00")), 24 * 60 * 60 * 1000);
  });
});

describe("offer shows once per browser session", () => {
  beforeEach(() => resetOfferPageLoadForTests());

  const memoryStorage = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };

  it("first time yes, then no, and it is recorded", () => {
    const s = memoryStorage();
    assert.equal(claimOfferShow(s), true);
    assert.equal(s.m.get(OFFER_SEEN_KEY), "1");
    assert.equal(claimOfferShow(s), false);
  });

  it("when storage throws or is missing: once per page load", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    assert.equal(claimOfferShow(broken), true);
    assert.equal(claimOfferShow(broken), false);
    assert.equal(claimOfferShow(null), false);
    resetOfferPageLoadForTests();
    assert.equal(claimOfferShow(null), true);
  });
});

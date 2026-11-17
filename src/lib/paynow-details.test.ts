import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isMissingPaynowMobileColumn,
  normalizePaynowMobile,
  paynowApplicationFields,
  paynowPrefill,
  paynowProblem,
} from "./paynow-details.ts";
import { resolvePartnerScreen } from "./partner-routing.ts";
import type { CookApplication, Profile } from "./types-auth.ts";

describe("PayNow mobile number", () => {
  it("accepts 8 digits starting with 8 or 9, with or without +65 and spacing", () => {
    for (const ok of ["91234567", "81234567", "+65 9123 4567", "+6591234567", "65 9123 4567", "9123-4567", " 91234567 "]) {
      assert.equal(paynowProblem(ok, ""), null, ok);
      assert.equal(paynowApplicationFields(ok, "").paynow_mobile, ok.includes("8123") ? "81234567" : "91234567", ok);
    }
  });

  it("rejects landlines, short numbers and letters with a friendly message", () => {
    for (const bad of ["61234567", "9123456", "912345678", "+60 91234567", "9123456a"]) {
      const p = paynowProblem(bad, "");
      assert.equal(p?.code, "invalid_mobile", bad);
      assert.equal(p?.field, "paynow_mobile");
      assert.match(p!.message, /8 digits starting with 8 or 9/);
    }
  });

  it("only strips a bare 65 when it is clearly a country code", () => {
    assert.equal(normalizePaynowMobile("6591234567"), "91234567");
    assert.equal(normalizePaynowMobile("65123456"), "65123456"); // 8 digits: not stripped (and not valid)
  });
});

describe("PayNow UEN", () => {
  it("accepts the common ACRA formats, any case, with stray spaces", () => {
    for (const ok of ["53123456X", "202412345K", "T24LL1234A", "s99ab1234c", " 2024 12345K "]) {
      assert.equal(paynowProblem("", ok), null, ok);
    }
    assert.equal(paynowApplicationFields("", " t24ll1234a ").paynow_uen, "T24LL1234A");
  });

  it("rejects things that are not a UEN", () => {
    for (const bad of ["12345", "91234567", "ABCDEFGHIJ", "X24LL1234A"]) {
      assert.equal(paynowProblem("", bad)?.code, "invalid_uen", bad);
    }
  });
});

describe("at least one PayNow method", () => {
  it("needs one of the two", () => {
    const p = paynowProblem(" ", "");
    assert.equal(p?.code, "paynow_missing");
    assert.match(p!.message, /one is enough/);
  });

  it("is fine with either alone, or both", () => {
    assert.equal(paynowProblem("91234567", ""), null);
    assert.equal(paynowProblem("", "53123456X"), null);
    assert.equal(paynowProblem("91234567", "53123456X"), null);
  });

  it("stores empty boxes as null", () => {
    assert.deepEqual(paynowApplicationFields("", "53123456X"), { paynow_mobile: null, paynow_uen: "53123456X" });
    assert.deepEqual(paynowApplicationFields("91234567", ""), { paynow_mobile: "91234567", paynow_uen: null });
  });
});

describe("Kitchen Setup pre-fill from the application", () => {
  it("uses the UEN when both are given", () => {
    assert.deepEqual(paynowPrefill({ paynow_uen: "53123456X", paynow_mobile: "91234567" }), { type: "uen", value: "53123456X" });
  });

  it("uses the mobile number when there is no UEN", () => {
    assert.deepEqual(paynowPrefill({ paynow_uen: null, paynow_mobile: "91234567" }), { type: "mobile", value: "91234567" });
  });

  it("treats an old free-text 'UEN' that is really a mobile number as a mobile number", () => {
    assert.deepEqual(paynowPrefill({ paynow_uen: "+65 9123 4567" }), { type: "mobile", value: "91234567" });
  });

  it("pre-fills nothing for old values that are neither, or for no PayNow at all", () => {
    assert.equal(paynowPrefill({ paynow_uen: "DBS 123-456789-0" }), null);
    assert.equal(paynowPrefill({ paynow_uen: null }), null);
  });

  it("reaches first-time Kitchen Setup through partner routing", () => {
    const cook: Profile = { id: "u-1", role: "cook", full_name: "T", phone: null, photo_url: null, is_active: true };
    const app = {
      id: "a-1", user_id: "u-1", business_name: "Kopi", business_type: "Home Cook", status: "approved",
      created_at: "2026-11-01T00:00:00Z", paynow_uen: null, paynow_mobile: "81234567", description: null,
    } as CookApplication;
    const screen = resolvePartnerScreen({ profile: cook, cookApp: app, riderApp: null, kitchen: null });
    assert.equal(screen.kind, "kitchen-setup");
    if (screen.kind !== "kitchen-setup") return;
    assert.equal(screen.defaults.paynow_type, "mobile");
    assert.equal(screen.defaults.paynow_value, "81234567");
    // No description asked at sign-up any more: Kitchen Setup starts it empty.
    assert.equal(screen.defaults.description, "");

    const noPaynow = resolvePartnerScreen({ profile: cook, cookApp: { ...app, paynow_mobile: undefined }, riderApp: null, kitchen: null });
    assert.ok(noPaynow.kind === "kitchen-setup" && !("paynow_type" in noPaynow.defaults));
  });
});

describe("isMissingPaynowMobileColumn", () => {
  it("only matches the missing paynow_mobile column", () => {
    assert.equal(isMissingPaynowMobileColumn({ code: "PGRST204", message: "Could not find the 'paynow_mobile' column of 'cook_applications'" }), true);
    assert.equal(isMissingPaynowMobileColumn({ code: "PGRST204", message: "Could not find the 'privacy_policy_version' column" }), false);
    assert.equal(isMissingPaynowMobileColumn({ code: "23514", message: "paynow_mobile bad" }), false);
    assert.equal(isMissingPaynowMobileColumn(null), false);
  });
});

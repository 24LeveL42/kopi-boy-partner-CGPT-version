import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COOK_PRIVACY_COPY,
  GPS_CONSENT_COPY,
  PRIVACY_CHECKBOX,
  PRIVACY_POLICY_URL,
  PRIVACY_POLICY_VERSION,
  RIDER_PRIVACY_COPY,
  consentFields,
  isMissingConsentColumns,
  privacyCopyFor,
  withoutConsentFields,
} from "./privacy-consent.ts";

describe("consentFields", () => {
  it("refuses an application without the acknowledgement", () => {
    assert.equal(consentFields("cook", false, false), null);
    assert.equal(consentFields("rider", false, true), null); // GPS alone isn't enough
  });

  it("sends only the version for a cook", () => {
    assert.deepEqual(consentFields("cook", true, true), { privacy_policy_version: PRIVACY_POLICY_VERSION });
  });

  it("sends the rider's GPS answer, false unless ticked", () => {
    assert.deepEqual(consentFields("rider", true, false), { privacy_policy_version: PRIVACY_POLICY_VERSION, gps_consent: false });
    assert.deepEqual(consentFields("rider", true, true), { privacy_policy_version: PRIVACY_POLICY_VERSION, gps_consent: true });
  });

  it("never sends a timestamp: the database stamps it", () => {
    const fields = consentFields("rider", true, true) as Record<string, unknown>;
    assert.equal("privacy_acknowledged_at" in fields, false);
    assert.equal("gps_consent_at" in fields, false);
  });

  it("uses a version the database accepts", () => {
    assert.match(PRIVACY_POLICY_VERSION, /^[0-9A-Za-z._-]{1,32}$/);
  });
});

describe("isMissingConsentColumns", () => {
  it("spots the columns not being there yet", () => {
    assert.equal(
      isMissingConsentColumns({ code: "PGRST204", message: "Could not find the 'privacy_policy_version' column of 'cook_applications' in the schema cache" }),
      true
    );
    assert.equal(isMissingConsentColumns({ code: "PGRST204", message: "Could not find the 'gps_consent' column of 'rider_applications'" }), true);
    assert.equal(isMissingConsentColumns({ code: "42703", message: 'column "privacy_policy_version" of relation "rider_applications" does not exist' }), true);
  });

  it("leaves every other error alone, including the database's refusal", () => {
    assert.equal(isMissingConsentColumns(null), false);
    assert.equal(isMissingConsentColumns({ code: "23514", message: "Please tick the Privacy Policy acknowledgement before submitting." }), false);
    assert.equal(isMissingConsentColumns({ code: "PGRST204", message: "Could not find the 'photo_url' column" }), false);
    assert.equal(isMissingConsentColumns({ code: "42501", message: "new row violates row-level security policy" }), false);
  });
});

describe("withoutConsentFields", () => {
  it("drops exactly the consent fields", () => {
    const row = { user_id: "u", vehicle_type: "Car", privacy_policy_version: "v", gps_consent: true };
    assert.deepEqual(withoutConsentFields(row), { user_id: "u", vehicle_type: "Car" });
    assert.deepEqual(row.gps_consent, true); // the original isn't changed
  });
});

describe("wording", () => {
  it("picks the copy for the role", () => {
    assert.equal(privacyCopyFor("cook"), COOK_PRIVACY_COPY);
    assert.equal(privacyCopyFor("rider"), RIDER_PRIVACY_COPY);
  });

  it("keeps the agreed headings and tick boxes", () => {
    assert.equal(COOK_PRIVACY_COPY.heading, "Privacy Policy Acknowledgement");
    assert.equal(COOK_PRIVACY_COPY.points.length, 4);
    assert.equal(RIDER_PRIVACY_COPY.heading, "Privacy Policy & Location Sharing Acknowledgement");
    assert.equal(RIDER_PRIVACY_COPY.points.length, 6);
    assert.equal(PRIVACY_CHECKBOX, "I acknowledge that I have read and understood Kopi Boy's Privacy Policy.");
    assert.equal(GPS_CONSENT_COPY.note, "GPS sharing is optional. You may choose not to enable it.");
  });

  it("has no Privacy Policy link until a real page exists", () => {
    assert.equal(PRIVACY_POLICY_URL, null);
  });
});

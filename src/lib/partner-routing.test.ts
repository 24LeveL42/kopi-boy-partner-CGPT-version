import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolvePartnerScreen } from "./partner-routing.ts";
import { BLOCKED_SCREEN_COPY } from "./admin-messages.ts";
import type { Profile, CookApplication, RiderApplication } from "./types-auth.ts";
import type { Kitchen } from "./types-kitchen.ts";

const profile = (role: Profile["role"], is_active: boolean): Profile => ({
  id: "u-1",
  role,
  full_name: "Test",
  phone: null,
  photo_url: null,
  is_active,
});

const cookApp = { id: "a-1", user_id: "u-1", business_name: "Kopi", status: "approved", created_at: "2026-01-01T00:00:00Z" } as CookApplication;
const kitchen = { id: "u-1", business_name: "Kopi" } as Kitchen;
const none = { cookApp: null, riderApp: null, kitchen: null };
const riderApp = { id: "a-2", user_id: "u-1", status: "approved", created_at: "2026-02-01T00:00:00Z" } as RiderApplication;

describe("blocked screen routing", () => {
  it("sends a blocked rider to the blocked screen instead of the rider area", () => {
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: profile("rider", false) }), { kind: "blocked" });
  });

  it("sends a blocked cook to the blocked screen, with or without a kitchen", () => {
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: profile("cook", false), cookApp, kitchen }), { kind: "blocked" });
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: profile("cook", false), cookApp }), { kind: "blocked" });
  });

  it("keeps a blocked account with the retired picker role blocked", () => {
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: profile("picker", false) }), { kind: "blocked" });
  });

  it("leaves active partners on their dashboards", () => {
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: profile("rider", true) }), { kind: "partner-shell", view: "rider" });
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: profile("cook", true), cookApp, kitchen }), {
      kind: "partner-shell",
      view: "cook",
    });
  });

  it("uses the agreed copy and never mentions a reason", () => {
    assert.equal(BLOCKED_SCREEN_COPY.title, "Your account is blocked");
    assert.equal(
      BLOCKED_SCREEN_COPY.body,
      "Please contact the admin below. You can't accept deliveries until your account is unblocked."
    );
    assert.doesNotMatch(`${BLOCKED_SCREEN_COPY.title} ${BLOCKED_SCREEN_COPY.body}`, /reason|because/i);
  });
});

describe("retired picker role", () => {
  it("never routes anyone to a picker screen", () => {
    const screen = resolvePartnerScreen({ ...none, profile: profile("picker", true) });
    assert.deepEqual(screen, { kind: "apply" });
  });

  it("lets an old picker account apply as a cook or rider like anyone else", () => {
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: profile("picker", true), riderApp }), {
      kind: "partner-shell",
      view: "rider",
    });
    assert.deepEqual(
      resolvePartnerScreen({ ...none, profile: profile("picker", true), riderApp: { ...riderApp, status: "pending" } }),
      { kind: "application-pending" }
    );
  });
});

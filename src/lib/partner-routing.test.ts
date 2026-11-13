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
    // Approved, role not switched to rider yet: wait on "Almost there".
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: profile("picker", true), riderApp }), {
      kind: "approval-finishing",
      as: "rider",
    });
    assert.deepEqual(
      resolvePartnerScreen({ ...none, profile: profile("picker", true), riderApp: { ...riderApp, status: "pending" } }),
      { kind: "application-pending", as: "rider" }
    );
  });
});

describe("kitchen load error (kitchen privacy Phase 2)", () => {
  it("never sends a cook to Kitchen Setup when the kitchen couldn't be loaded", () => {
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: profile("cook", true), cookApp, kitchenError: true }), { kind: "kitchen-load-error" });
    // Approved cook whose role hasn't caught up yet: "Almost there", never setup.
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: profile("customer", true), cookApp, kitchenError: true }), { kind: "approval-finishing", as: "cook" });
  });

  it("still shows the shell when the kitchen loaded, and setup when there truly is none", () => {
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: profile("cook", true), cookApp, kitchen: { id: "u-1" } }), { kind: "partner-shell", view: "cook" });
    assert.equal(resolvePartnerScreen({ ...none, profile: profile("cook", true), cookApp }).kind, "kitchen-setup");
  });

  it("doesn't affect riders or blocked partners", () => {
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: profile("rider", true), kitchenError: true }), { kind: "partner-shell", view: "rider" });
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: profile("cook", false), cookApp, kitchenError: true }), { kind: "blocked" });
  });
});

describe("HQ (admin) accounts", () => {
  const admin = profile("admin", true);
  const pendingCook = { ...cookApp, status: "pending" } as CookApplication;
  const rejectedCook = { ...cookApp, status: "rejected" } as CookApplication;

  it("always get the HQ account screen, never apply, setup or a dashboard", () => {
    const cases = [
      { ...none, profile: admin },
      { ...none, profile: admin, cookApp: pendingCook },
      { ...none, profile: admin, cookApp },
      { ...none, profile: admin, cookApp: rejectedCook },
      { ...none, profile: admin, cookApp, kitchen },
      { ...none, profile: admin, riderApp },
      { ...none, profile: admin, cookApp, kitchenError: true },
      { ...none, profile: profile("admin", false), cookApp },
    ];
    for (const input of cases) assert.deepEqual(resolvePartnerScreen(input), { kind: "staff-account" });
  });
});

describe("approved but role not promoted yet", () => {
  it("waits on 'Almost there' (the database refuses a non-cook's kitchen save, a non-rider's deliveries)", () => {
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: profile("customer", true), cookApp }), { kind: "approval-finishing", as: "cook" });
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: profile("customer", true), cookApp, kitchen }), { kind: "approval-finishing", as: "cook" });
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: profile("customer", true), riderApp }), { kind: "approval-finishing", as: "rider" });
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: null, cookApp }), { kind: "approval-finishing", as: "cook" });
  });

  it("a promoted cook still goes to Kitchen Setup, then the dashboard", () => {
    assert.equal(resolvePartnerScreen({ ...none, profile: profile("cook", true), cookApp }).kind, "kitchen-setup");
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: profile("cook", true), cookApp, kitchen }), { kind: "partner-shell", view: "cook" });
  });
});

describe("pending and rejected applications", () => {
  it("pending says which kind, by the latest application", () => {
    const pendingCook = { ...cookApp, status: "pending", created_at: "2026-03-01T00:00:00Z" } as CookApplication;
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: profile("customer", true), cookApp: pendingCook }), { kind: "application-pending", as: "cook" });
    assert.deepEqual(
      resolvePartnerScreen({ ...none, profile: profile("customer", true), riderApp: { ...riderApp, status: "pending" } }),
      { kind: "application-pending", as: "rider" }
    );
    // Latest wins: a newer pending cook application over an older approved rider one.
    assert.deepEqual(resolvePartnerScreen({ ...none, profile: profile("customer", true), cookApp: pendingCook, riderApp }), { kind: "application-pending", as: "cook" });
  });

  it("rejected goes to the rejected screen", () => {
    assert.deepEqual(
      resolvePartnerScreen({ ...none, profile: profile("customer", true), cookApp: { ...cookApp, status: "rejected" } as CookApplication }),
      { kind: "application-rejected" }
    );
  });
});

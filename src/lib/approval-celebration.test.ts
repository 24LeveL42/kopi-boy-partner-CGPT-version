import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { approvalCelebrationFor, celebrationGreeting } from "./approval-celebration.ts";
import { resolvePartnerScreen, type PartnerScreen } from "./partner-routing.ts";
import type { Profile, RiderApplication } from "./types-auth.ts";

const setup: PartnerScreen = {
  kind: "kitchen-setup",
  defaults: { business_name: "Kopi", category: "home-cook", business_address: "", postal_code: "", latitude: null, longitude: null, description: "" },
};
const cookShell: PartnerScreen = { kind: "partner-shell", view: "cook" };
const riderShell: PartnerScreen = { kind: "partner-shell", view: "rider" };
const notYet = { approval_celebrated: false };

describe("approvalCelebrationFor", () => {
  it("cook on Kitchen Setup: 'Set up my kitchen' just closes the card (setup is behind it)", () => {
    assert.deepEqual(approvalCelebrationFor(setup, notYet), { buttonLabel: "Set up my kitchen", href: null });
  });

  it("cook on the dashboard: 'Set up my kitchen' goes to /kitchen", () => {
    assert.deepEqual(approvalCelebrationFor(cookShell, notYet), { buttonLabel: "Set up my kitchen", href: "/kitchen" });
  });

  it("rider on the dashboard: 'Start delivering' just closes the card", () => {
    assert.deepEqual(approvalCelebrationFor(riderShell, notYet), { buttonLabel: "Start delivering", href: null });
  });

  it("never plays twice", () => {
    for (const screen of [setup, cookShell, riderShell]) {
      assert.equal(approvalCelebrationFor(screen, { approval_celebrated: true }), null);
    }
  });

  it("stays off before the SQL has run (no column) or with no profile", () => {
    assert.equal(approvalCelebrationFor(riderShell, {}), null);
    assert.equal(approvalCelebrationFor(setup, null), null);
  });

  it("never plays for applicants, rejected, blocked, the join screen or the kitchen error screen", () => {
    const others: PartnerScreen[] = [
      { kind: "application-pending" },
      { kind: "application-rejected" },
      { kind: "blocked" },
      { kind: "apply" },
      { kind: "kitchen-load-error" },
    ];
    for (const screen of others) assert.equal(approvalCelebrationFor(screen, notYet), null, screen.kind);
  });

  it("never plays for the retired picker role, active or blocked", () => {
    const picker = (is_active: boolean): Profile => ({
      id: "u-1", role: "picker", full_name: "P", phone: null, photo_url: null, is_active, approval_celebrated: false,
    });
    for (const is_active of [true, false]) {
      const p = picker(is_active);
      const screen = resolvePartnerScreen({ profile: p, cookApp: null, riderApp: null, kitchen: null });
      assert.equal(approvalCelebrationFor(screen, p), null, `picker active=${is_active}`);
    }
  });

  it("plays for an approved rider whose role hasn't been promoted yet (routed to the rider dashboard)", () => {
    const p: Profile = { id: "u-1", role: "customer", full_name: "R", phone: null, photo_url: null, is_active: true, approval_celebrated: false };
    const riderApp = { id: "a-1", user_id: "u-1", status: "approved", created_at: "2026-01-01T00:00:00Z" } as RiderApplication;
    const screen = resolvePartnerScreen({ profile: p, cookApp: null, riderApp, kitchen: null });
    assert.deepEqual(approvalCelebrationFor(screen, p), { buttonLabel: "Start delivering", href: null });
  });
});

describe("celebrationGreeting", () => {
  it("uses the full name, trimmed, with runs of spaces tidied", () => {
    assert.equal(celebrationGreeting("Tan Ah Hock"), "Welcome to the Kopi Boy family, Tan Ah Hock!");
    assert.equal(celebrationGreeting("  Siti   Rahman "), "Welcome to the Kopi Boy family, Siti Rahman!");
    assert.equal(celebrationGreeting("Priya"), "Welcome to the Kopi Boy family, Priya!");
  });

  it("drops the name when there isn't one", () => {
    assert.equal(celebrationGreeting(null), "Welcome to the Kopi Boy family!");
    assert.equal(celebrationGreeting("   "), "Welcome to the Kopi Boy family!");
  });
});

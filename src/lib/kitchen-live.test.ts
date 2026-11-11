import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { customerKitchenUrl, shouldShowKitchenLive, KITCHEN_WELCOME_BANNER } from "./kitchen-live.ts";
import type { PartnerScreen } from "./partner-routing.ts";

const cookShell: PartnerScreen = { kind: "partner-shell", view: "cook" };
const notSeen = { kitchen_live_seen: false };
const liveKitchen = { is_live: true, is_blocked: false };
const base = { screen: cookShell, profile: notSeen, kitchen: liveKitchen, approvalCelebrationShowing: false };

describe("customerKitchenUrl", () => {
  it("is the Customer app's /merchant/{id} page on kopi-boy.com", () => {
    assert.equal(
      customerKitchenUrl("00000000-0000-4000-8000-000000000001"),
      "https://kopi-boy.com/merchant/00000000-0000-4000-8000-000000000001",
    );
  });
});

describe("KITCHEN_WELCOME_BANNER", () => {
  it("is the agreed text", () => {
    assert.equal(KITCHEN_WELCOME_BANNER, "Set up your menu and prices below. Once you save, customers can see your kitchen on kopi-boy.com.");
  });
});

describe("shouldShowKitchenLive", () => {
  it("shows on the cook dashboard after the first save (live, not blocked, not seen)", () => {
    assert.equal(shouldShowKitchenLive(base), true);
  });

  it("never shows again once closed", () => {
    assert.equal(shouldShowKitchenLive({ ...base, profile: { kitchen_live_seen: true } }), false);
  });

  it("stays off before the SQL has run (no column) or with no profile", () => {
    assert.equal(shouldShowKitchenLive({ ...base, profile: {} }), false);
    assert.equal(shouldShowKitchenLive({ ...base, profile: null }), false);
  });

  it("never shows for a blocked kitchen", () => {
    assert.equal(shouldShowKitchenLive({ ...base, kitchen: { is_live: true, is_blocked: true } }), false);
  });

  it("never shows for a kitchen that isn't live (its customer page would be a 404), or no kitchen", () => {
    assert.equal(shouldShowKitchenLive({ ...base, kitchen: { is_live: false, is_blocked: false } }), false);
    assert.equal(shouldShowKitchenLive({ ...base, kitchen: null }), false);
  });

  it("waits while the approval celebration is showing", () => {
    assert.equal(shouldShowKitchenLive({ ...base, approvalCelebrationShowing: true }), false);
  });

  it("is for the cook dashboard only: not Kitchen Setup, riders or any other screen", () => {
    const others: PartnerScreen[] = [
      { kind: "partner-shell", view: "rider" },
      { kind: "kitchen-setup", defaults: { business_name: "K", category: "home-cook", business_address: "", postal_code: "", latitude: null, longitude: null, description: "" } },
      { kind: "blocked" },
      { kind: "application-pending" },
      { kind: "kitchen-load-error" },
    ];
    for (const screen of others) assert.equal(shouldShowKitchenLive({ ...base, screen }), false, screen.kind);
  });
});

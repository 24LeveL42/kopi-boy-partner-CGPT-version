import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { welcomeDecision, WELCOME_LOGIN_PATH } from "./welcome.ts";
import { resolvePartnerScreen } from "./partner-routing.ts";
import { COOK_PRICING_LINE } from "./onboarding-copy.ts";
import type { Profile, CookApplication, RiderApplication } from "./types-auth.ts";

const profile = (role: Profile["role"], extra: Partial<Profile> = {}): Profile => ({
  id: "u-1",
  role,
  full_name: "Tan Ah Hock",
  phone: null,
  photo_url: null,
  is_active: true,
  approval_celebrated: false,
  ...extra,
});
const cookApp = (status: CookApplication["status"]) =>
  ({ id: "a-1", user_id: "u-1", business_name: "Kopi", status, created_at: "2026-01-01T00:00:00Z" }) as CookApplication;
const riderApp = (status: RiderApplication["status"]) =>
  ({ id: "a-2", user_id: "u-1", status, created_at: "2026-01-01T00:00:00Z" }) as RiderApplication;
const liveKitchen = { id: "u-1", business_name: "Kopi", is_live: true, is_blocked: false };

function decide(p: Profile | null, input: { cookApp?: CookApplication; riderApp?: RiderApplication; kitchen?: typeof liveKitchen; kitchenError?: boolean }) {
  const kitchen = input.kitchen ?? null;
  const screen = resolvePartnerScreen({ profile: p, cookApp: input.cookApp ?? null, riderApp: input.riderApp ?? null, kitchen, kitchenError: input.kitchenError });
  return welcomeDecision({ signedIn: true, screen, profile: p, kitchen });
}

describe("/welcome: never celebrates someone who isn't approved", () => {
  it("signed out: sign in, then back to /welcome", () => {
    assert.deepEqual(welcomeDecision({ signedIn: false, screen: null, profile: null, kitchen: null }), { kind: "redirect", to: WELCOME_LOGIN_PATH });
    assert.equal(WELCOME_LOGIN_PATH, "/login?next=/welcome");
  });

  it("pending, rejected, blocked, no application, kitchen error: back to '/', which shows their screen", () => {
    const cases = [
      decide(profile("customer"), { cookApp: cookApp("pending") }),
      decide(profile("customer"), { riderApp: riderApp("pending") }),
      decide(profile("customer"), { cookApp: cookApp("rejected") }),
      decide(profile("cook", { is_active: false }), { cookApp: cookApp("approved"), kitchen: liveKitchen }),
      decide(profile("rider", { is_active: false }), {}),
      decide(profile("customer"), {}),
      decide(profile("cook"), { cookApp: cookApp("approved"), kitchenError: true }),
    ];
    for (const d of cases) assert.deepEqual(d, { kind: "redirect", to: "/" });
  });

  it("HQ accounts get the HQ screen, even with an approved application", () => {
    assert.deepEqual(decide(profile("admin"), { cookApp: cookApp("approved") }), { kind: "staff-account" });
  });

  it("approved but role not promoted yet: 'Almost there', no celebration", () => {
    assert.deepEqual(decide(profile("customer"), { cookApp: cookApp("approved") }), { kind: "approval-finishing" });
    assert.deepEqual(decide(profile("customer"), { riderApp: riderApp("approved") }), { kind: "approval-finishing" });
  });
});

describe("/welcome: approved partners", () => {
  it("new cook (no kitchen yet): 'Your kitchen is approved!', Set up my kitchen -> '/', pricing, confetti", () => {
    const d = decide(profile("cook"), { cookApp: cookApp("approved") });
    assert.equal(d.kind, "celebrate");
    if (d.kind !== "celebrate") return;
    assert.equal(d.role, "cook");
    assert.equal(d.title, "Your kitchen is approved!");
    assert.equal(d.greeting, "Welcome to the Kopi Boy family, Tan Ah Hock!");
    assert.equal(d.pricing, COOK_PRICING_LINE);
    assert.deepEqual(d.primary, { label: "Set up my kitchen", href: "/" });
    assert.equal(d.secondary, null);
    assert.equal(d.confetti, true);
  });

  it("cook with a live kitchen: Open my kitchen, plus See it live on kopi-boy.com", () => {
    const d = decide(profile("cook"), { cookApp: cookApp("approved"), kitchen: liveKitchen });
    assert.equal(d.kind, "celebrate");
    if (d.kind !== "celebrate") return;
    assert.deepEqual(d.primary, { label: "Open my kitchen", href: "/" });
    assert.deepEqual(d.secondary, { label: "See it live", href: "https://kopi-boy.com/merchant/u-1" });
  });

  it("no 'See it live' for a kitchen that isn't live or is blocked", () => {
    for (const kitchen of [{ ...liveKitchen, is_live: false }, { ...liveKitchen, is_blocked: true }]) {
      const d = decide(profile("cook"), { cookApp: cookApp("approved"), kitchen });
      assert.equal(d.kind === "celebrate" && d.secondary, null);
    }
  });

  it("rider: 'You're approved to ride!', Start delivering, no pricing line", () => {
    const d = decide(profile("rider"), {});
    assert.equal(d.kind, "celebrate");
    if (d.kind !== "celebrate") return;
    assert.equal(d.role, "rider");
    assert.equal(d.title, "You're approved to ride!");
    assert.deepEqual(d.primary, { label: "Start delivering", href: "/" });
    assert.equal(d.pricing, null);
  });

  it("confetti only the first time; already celebrated or no column yet: a calm card", () => {
    const seen = decide(profile("cook", { approval_celebrated: true }), { cookApp: cookApp("approved") });
    assert.equal(seen.kind === "celebrate" && seen.confetti, false);
    const noColumn = profile("rider");
    delete noColumn.approval_celebrated;
    const calm = decide(noColumn, {});
    assert.equal(calm.kind === "celebrate" && calm.confetti, false);
  });
});

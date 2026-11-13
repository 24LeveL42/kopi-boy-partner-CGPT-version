import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isInAppBrowser } from "./in-app-browser.ts";
import { authCallbackUrl } from "./auth-callback.ts";
import { celebrationBursts, isLowPowerDevice, MAX_PARTICLES, totalParticles, CELEBRATION_COLOURS } from "./celebration-confetti.ts";
import * as copy from "./onboarding-copy.ts";

describe("isInAppBrowser", () => {
  const inApp = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone14,2;FBMD/iPhone;FBSN/iOS;FBSV/17.0;FBSS/3;FBID/phone;FBLC/en_GB;FBOP/5]",
    "Mozilla/5.0 (Linux; Android 13; SM-A135F Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0.0.31.105;]",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 307.0.0.34.111",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/440.0]",
  ];
  const real = [
    "Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  ];
  it("spots Facebook, Instagram and Messenger", () => {
    for (const ua of inApp) assert.equal(isInAppBrowser(ua), true, ua);
  });
  it("leaves Chrome and Safari alone", () => {
    for (const ua of real) assert.equal(isInAppBrowser(ua), false, ua);
    assert.equal(isInAppBrowser(""), false);
    assert.equal(isInAppBrowser(undefined), false);
  });
});

describe("authCallbackUrl", () => {
  it("adds ?next= only when there is somewhere to go back to", () => {
    assert.equal(authCallbackUrl("https://p.example"), "https://p.example/auth/callback");
    assert.equal(authCallbackUrl("https://p.example", "/"), "https://p.example/auth/callback");
    assert.equal(authCallbackUrl("https://p.example", "/welcome"), "https://p.example/auth/callback?next=%2Fwelcome");
  });
  it("drops an unsafe next", () => {
    assert.equal(authCallbackUrl("https://p.example", "//evil.com"), "https://p.example/auth/callback");
    assert.equal(authCallbackUrl("https://p.example", "https://evil.com"), "https://p.example/auth/callback");
  });
});

describe("celebration confetti stays light", () => {
  it("is under the particle cap, and half on a low-power device", () => {
    const full = totalParticles(celebrationBursts(false));
    const low = totalParticles(celebrationBursts(true));
    assert.ok(full <= MAX_PARTICLES, `${full} particles`);
    assert.ok(low <= Math.ceil(full / 2) + 2, `${low} on low power`);
  });
  it("every burst respects reduce motion and uses the brand colours", () => {
    for (const b of celebrationBursts(false)) {
      assert.equal(b.options.disableForReducedMotion, true);
      assert.deepEqual(b.options.colors, CELEBRATION_COLOURS);
    }
  });
  it("low power = 4 cores or fewer, or 2 GB memory or less", () => {
    assert.equal(isLowPowerDevice({ hardwareConcurrency: 4 }), true);
    assert.equal(isLowPowerDevice({ hardwareConcurrency: 8, deviceMemory: 2 }), true);
    assert.equal(isLowPowerDevice({ hardwareConcurrency: 8, deviceMemory: 8 }), false);
    assert.equal(isLowPowerDevice({}), false);
    assert.equal(isLowPowerDevice(null), false);
  });
});

describe("journey wording", () => {
  const allText = JSON.stringify(copy);

  it("never mentions GST, tax or a free month", () => {
    assert.doesNotMatch(allText, /\bGST\b|\btax\b|free month|month free|first month/i);
  });

  it("states the pricing exactly", () => {
    assert.equal(copy.COOK_PRICING_LINE, "0% commission. S$29.95/month subscription.");
  });

  it("tells applicants the review time", () => {
    assert.match(copy.PENDING_COPY.message, /We usually review applications within 2 working days/);
    assert.equal(copy.PENDING_COPY.title, "Application received");
  });

  it("has no approval-email text (Boss sends that email)", () => {
    assert.doesNotMatch(allText, /subject:|dear /i);
  });
});

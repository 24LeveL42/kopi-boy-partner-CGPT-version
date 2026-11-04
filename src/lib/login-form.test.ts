import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// node --test can't load .tsx, so these check LoginForm's source: Google is
// the only sign-in method and none of the removed phone/SMS-code flow is left.
const source = readFileSync(new URL("../components/LoginForm.tsx", import.meta.url), "utf8");

describe("LoginForm: Google is the only sign-in method", () => {
  it("signs in with Google OAuth through /auth/callback", () => {
    assert.match(source, /signInWithOAuth\(\{\s*provider:\s*"google"/);
    assert.match(source, /redirectTo:\s*`\$\{window\.location\.origin\}\/auth\/callback`/);
    assert.match(source, /"Sign in with Google"/);
    assert.match(source, /"Sign up with Google"/);
  });

  it("has exactly one OAuth provider and one auth call", () => {
    assert.equal(source.match(/provider:/g)?.length, 1);
    assert.equal(source.match(/supabase\.auth\.\w+\(/g)?.length, 1);
  });

  it("makes no phone/SMS one-time-code calls", () => {
    for (const call of ["signInWithOtp", "verifyOtp", "resend(", 'type: "sms"', "shouldCreateUser"]) {
      assert.ok(!source.includes(call), `found ${call}`);
    }
  });

  it("renders no phone or code input, and no send/verify/resend UI", () => {
    assert.ok(!/type="tel"/.test(source), "phone input");
    assert.ok(!/inputMode="numeric"/.test(source), "numeric code input");
    assert.ok(!/<form/.test(source), "phone/code form");
    for (const text of [
      "or mobile",
      "Send sign-in code",
      "Send sign-up code",
      "Verify & continue",
      "6-digit code",
      "Use a different number",
      "Resend",
      "+65",
    ]) {
      assert.ok(!source.toLowerCase().includes(text.toLowerCase()), `found "${text}"`);
    }
  });

  it("helper text mentions Google only", () => {
    assert.match(source, /"Sign in with Google\."/);
    assert.ok(!/mobile number/i.test(source), "still mentions a mobile number");
    assert.ok(!/\bphone\b/i.test(source.replace(/\/\/.*$/gm, "")), "still mentions phone outside comments");
  });

  it("only has the choice and Google steps", () => {
    assert.match(source, /type Step = "choice" \| "google";/);
    assert.ok(!/enter-phone|enter-code/.test(source));
  });
});

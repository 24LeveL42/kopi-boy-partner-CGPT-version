import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EMAIL_CODE_COPY,
  EMAIL_CODE_ERRORS,
  RESEND_WAIT_SECONDS,
  cleanCode,
  isCompleteCode,
  isValidEmail,
  normalizeEmail,
  otpOptions,
  resendSecondsLeft,
  sendCodeError,
  verifyCodeError,
} from "./email-otp.ts";

describe("email address", () => {
  it("is trimmed and lower-cased, so the same Google email finds the same account", () => {
    assert.equal(normalizeEmail("  Tan.AhHock@Gmail.com "), "tan.ahhock@gmail.com");
  });

  it("catches obvious typos only", () => {
    for (const ok of ["a@b.co", "tan+kopi@gmail.com", " Tan@Example.COM "]) assert.ok(isValidEmail(ok), ok);
    for (const bad of ["", "tan", "tan@", "tan@gmail", "tan @gmail.com", "@gmail.com", "tan@gmail.c"]) assert.ok(!isValidEmail(bad), bad);
  });
});

describe("the code", () => {
  it("keeps digits only, whatever is pasted from the email", () => {
    assert.equal(cleanCode(" 123 456 "), "123456");
    assert.equal(cleanCode("123-456"), "123456");
    assert.equal(cleanCode("12345678901234"), "1234567890");
  });

  it("accepts any length Supabase can be set to (6 to 10), not just 6", () => {
    for (const ok of ["123456", "12345678", "1234567890"]) assert.ok(isCompleteCode(ok), ok);
    for (const bad of ["", "12345", "12345678901", "12a456"]) assert.ok(!isCompleteCode(bad), bad);
  });

  it("is never hard-coded to 6 digits in the sign-in screen", () => {
    const component = readFileSync(new URL("../components/EmailCodeSignIn.tsx", import.meta.url), "utf8");
    assert.ok(!/\b6-digit|six-digit|length\s*===\s*6|maxLength=\{6\}/i.test(component));
    assert.match(component, /maxLength=\{MAX_CODE_LENGTH\}/);
    assert.match(component, /isCompleteCode\(code\)/);
    for (const text of Object.values(EMAIL_CODE_COPY)) {
      if (typeof text === "string") assert.ok(!/\b6\b|six/i.test(text), text);
    }
  });
});

describe("Sign in vs Sign up", () => {
  it("Sign in never creates an account; Sign up does", () => {
    assert.deepEqual(otpOptions("signin"), { shouldCreateUser: false });
    assert.deepEqual(otpOptions("signup"), { shouldCreateUser: true });
  });

  it("Sign in with an unknown email says so plainly", () => {
    // What Supabase answers when shouldCreateUser is false and there's no such user.
    const unknown = { code: "otp_disabled", status: 422, message: "Signups not allowed for otp" };
    assert.equal(sendCodeError(unknown, "signin"), "no_account");
    assert.equal(EMAIL_CODE_ERRORS.no_account, "No account with this email. Tap Sign up instead.");
    // On Sign up the same answer can't mean "no account" (sign-ups would be off).
    assert.equal(sendCodeError(unknown, "signup"), "send_failed");
  });

  it("shows the agreed hint", () => {
    assert.equal(EMAIL_CODE_COPY.hint, "Use the same email as your Google account.");
    assert.equal(EMAIL_CODE_COPY.continueWithEmail, "Continue with email");
  });
});

describe("sending the code: friendly messages", () => {
  it("is fine when Supabase returns no error", () => {
    assert.equal(sendCodeError(null, "signin"), null);
  });

  it("asks to wait when there have been too many requests", () => {
    for (const e of [{ status: 429 }, { code: "over_email_send_rate_limit" }, { code: "over_request_rate_limit" }]) {
      assert.equal(sendCodeError(e, "signup"), "rate_limited");
    }
  });

  it("spots an email Supabase can't use, and anything else is a send failure", () => {
    assert.equal(sendCodeError({ code: "email_address_invalid", status: 400 }, "signup"), "invalid_email");
    assert.equal(sendCodeError({ status: 0, message: "Failed to fetch" }, "signin"), "send_failed");
    assert.equal(sendCodeError({ code: "unexpected_failure", status: 500 }, "signup"), "send_failed");
  });
});

describe("checking the code: friendly messages", () => {
  it("is fine when Supabase returns no error", () => {
    assert.equal(verifyCodeError(null), null);
  });

  it("a wrong or expired code (Supabase answers both the same way) gets one plain message", () => {
    assert.equal(verifyCodeError({ code: "otp_expired", status: 403, message: "Token has expired or is invalid" }), "code_rejected");
    assert.match(EMAIL_CODE_ERRORS.code_rejected, /mistyped or expired/);
    assert.match(EMAIL_CODE_ERRORS.code_rejected, /Resend code/);
  });

  it("too many tries asks to wait; a network problem asks to check the connection", () => {
    assert.equal(verifyCodeError({ code: "over_request_rate_limit", status: 429 }), "rate_limited");
    assert.equal(verifyCodeError({ status: 0, message: "Failed to fetch" }), "verify_failed");
    assert.match(EMAIL_CODE_ERRORS.verify_failed, /connection/);
  });

  it("never shows Supabase's own wording", () => {
    for (const message of Object.values(EMAIL_CODE_ERRORS)) assert.ok(!/token|otp|422|403/i.test(message), message);
  });
});

describe("Resend code", () => {
  it("waits 60 seconds after each code is sent", () => {
    assert.equal(RESEND_WAIT_SECONDS, 60);
    const sent = 1_000_000;
    assert.equal(resendSecondsLeft(null, sent), 0);
    assert.equal(resendSecondsLeft(sent, sent), 60);
    assert.equal(resendSecondsLeft(sent, sent + 59_001), 1);
    assert.equal(resendSecondsLeft(sent, sent + 60_000), 0);
    assert.equal(resendSecondsLeft(sent, sent + 600_000), 0);
    assert.equal(EMAIL_CODE_COPY.resendIn(42), "Resend code in 42s");
  });
});

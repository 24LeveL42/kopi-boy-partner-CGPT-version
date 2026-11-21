import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IN_APP_BROWSER_COPY } from "./onboarding-copy.ts";

// node --test can't load .tsx, so these check the components' source:
// LoginForm itself only does Google (none of the removed phone/SMS-code flow
// is left); the email code lives in EmailCodeSignIn, offered only inside
// in-app browsers.
const source = readFileSync(new URL("../components/LoginForm.tsx", import.meta.url), "utf8");
const emailSource = readFileSync(new URL("../components/EmailCodeSignIn.tsx", import.meta.url), "utf8");

describe("LoginForm: its own sign-in is Google only", () => {
  it("signs in with Google OAuth through /auth/callback", () => {
    assert.match(source, /signInWithOAuth\(\{\s*provider:\s*"google"/);
    // /auth/callback, carrying ?next= (e.g. /welcome) — see auth-callback.ts.
    assert.match(source, /redirectTo:\s*authCallbackUrl\(window\.location\.origin, next\)/);
    assert.match(source, /"Sign in with Google"/);
    assert.match(source, /"Sign up with Google"/);
  });

  it("always shows Google's account chooser, and keeps redirectTo with next", () => {
    const options = source.match(/signInWithOAuth\(\{[\s\S]*?options:\s*\{([\s\S]*?)\n\s*\},/)?.[1] ?? "";
    assert.match(options, /queryParams:\s*\{\s*prompt:\s*"select_account"\s*\}/);
    assert.match(options, /redirectTo:\s*authCallbackUrl\(window\.location\.origin, next\)/);
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

  it("has the choice and Google steps, plus the email steps (no phone steps)", () => {
    assert.match(source, /type Step = "choice" \| "google" \| "email" \| "code";/);
    assert.ok(!/enter-phone|enter-code/.test(source));
  });
});

describe("LoginForm: email code inside in-app browsers only", () => {
  it("offers Continue with email only behind the in-app browser check, before the Google button", () => {
    const offer = source.indexOf("EMAIL_CODE_COPY.continueWithEmail");
    assert.ok(offer > 0);
    const guard = source.lastIndexOf("{inAppBrowser && (", offer);
    assert.ok(guard > 0 && offer - guard < 400, "Continue with email is not behind the in-app browser check");
    assert.ok(offer < source.indexOf("onClick={handleGoogleSignIn}"), "email should come before Google");
    // Reached only through that button (or Back from the code step).
    assert.equal(source.match(/setStep\("email"\)/g)?.length, 1);
  });

  it("keeps the normal browser's helper text, and Google stays on the in-app screen too", () => {
    assert.match(source, /: inAppBrowser\s*\?\s*"Continue with email, or sign in with Google\."\s*:\s*"Sign in with Google\."/);
    assert.equal(source.match(/onClick=\{handleGoogleSignIn\}/g)?.length, 1);
  });

  it("leaves the Google sign-in call as it was", () => {
    assert.match(source, /function handleGoogleSignIn\(\) \{\s*\/\/ Sent now \(keepalive\), before the page leaves for Google\.\s*trackerRef\.current\?\.track\(\{ event: "signin_click" \}\);/);
  });

  it("Back steps code → email → Google choice → start", () => {
    assert.match(source, /setStep\(step === "code" \? "email" : step === "email" \? "google" : "choice"\)/);
  });

  it("switching Sign in / Sign up on the email steps stays there", () => {
    assert.match(source, /current === "email" \|\| current === "code" \? current : "google"/);
  });
});

describe("EmailCodeSignIn", () => {
  it("sends with the intent's options: Sign in never creates an account", () => {
    assert.match(emailSource, /signInWithOtp\(\{ email: to, options: otpOptions\(intent\) \}\)/);
  });

  it("checks the code in this same screen (type email), then does a full load of next", () => {
    assert.match(emailSource, /verifyOtp\(\{ email: sentTo, token: code, type: "email" \}\)/);
    assert.match(emailSource, /window\.location\.assign\(next\)/);
    assert.ok(!/emailRedirectTo/.test(emailSource), "no link in the email: it would open another browser");
  });

  it("shows the hint, Resend with a wait, and Use a different email", () => {
    assert.match(emailSource, /EMAIL_CODE_COPY\.hint/);
    assert.match(emailSource, /disabled=\{busy \|\| waitLeft > 0\}/);
    assert.match(emailSource, /EMAIL_CODE_COPY\.resendIn\(waitLeft\)/);
    assert.match(emailSource, /EMAIL_CODE_COPY\.differentEmail/);
  });

  it("tracks sent codes and errors with short codes only, never the email or the code", () => {
    assert.match(emailSource, /track\(\{ event: "email_code_sent" \}\)/);
    assert.match(emailSource, /track\(\{ event: "email_code_error", code \}\)/);
    assert.equal(emailSource.match(/track\(\{/g)?.length, 2);
  });

  it("never shows Supabase's raw error text", () => {
    assert.ok(!/setError\(\w*[eE]rror\.message\)/.test(emailSource));
  });
});

describe("LoginForm: never stuck on 'Redirecting…'", () => {
  it("doesn't wait forever for Google: Back (pageshow) or a time limit frees the button", () => {
    assert.ok(!source.includes("new Promise<never>(() => {})"), "a promise that never settles");
    assert.match(source, /addEventListener\("pageshow"/);
    assert.match(source, /GOOGLE_WAIT_MS/);
    assert.match(source, /GOOGLE_SLOW_MESSAGE/);
  });

  it("shows the open-in-browser hint inside Facebook / Instagram", () => {
    assert.match(source, /isInAppBrowser\(navigator\.userAgent\)/);
    assert.match(source, /IN_APP_BROWSER_COPY\.title/);
  });
});

describe("LoginForm: in-app browser banner", () => {
  it("uses the agreed plain-language wording, with a Copy link button", () => {
    assert.equal(IN_APP_BROWSER_COPY.message, "Google sign-in doesn't work inside this app. To use Google, tap the ⋮ or ⋯ (or share) icon and choose 'Open in browser'. Or continue with email below.");
    assert.equal(IN_APP_BROWSER_COPY.title, "To use Google, open in your browser");
    assert.equal(IN_APP_BROWSER_COPY.note, "To use Google, you can also copy the link and paste it into Chrome or Safari.");
    assert.equal(IN_APP_BROWSER_COPY.copyFailed, "Couldn't copy. Please use the ⋮ or ⋯ (or share) icon instead.");
    assert.equal(IN_APP_BROWSER_COPY.copyLink, "Copy link");
    assert.match(source, /IN_APP_BROWSER_COPY\.message/);
    assert.match(source, /onClick=\{copyLink\}/);
  });

  it("names both menu icons wherever it mentions one (Android ⋮, iPhone / TikTok / WeChat ⋯)", () => {
    // One banner serves every detected app, so every line of it must name both.
    for (const text of Object.values(IN_APP_BROWSER_COPY)) {
      if (text.includes("⋮") || text.includes("⋯")) assert.match(text, /⋮ or ⋯ \(or share\)/, text);
    }
    // And the form uses only this copy: no menu icon written into the component itself.
    assert.ok(!/[⋮⋯]/.test(source));
  });

  it("only appears inside an in-app browser, and never on the server render", () => {
    // Rendered only behind the user-agent check; the server snapshot is a normal browser.
    assert.match(source, /\{inAppBrowser && \(/);
    assert.match(source, /useSyncExternalStore\(subscribeNever, \(\) => isInAppBrowser\(navigator\.userAgent\), \(\) => false\)/);
  });

  it("copies with a fallback and never throws (no bare navigator.clipboard call)", () => {
    assert.match(source, /copyText\(window\.location\.href, \{ clipboard: navigator\.clipboard, legacyCopy \}\)/);
    assert.ok(!/navigator\.clipboard\s*\.\s*writeText/.test(source));
  });

  it("keeps the Google button: the banner is a hint, not a block", () => {
    assert.match(source, /onClick=\{handleGoogleSignIn\}/);
    assert.ok(!/inAppBrowser\s*\?\s*null/.test(source));
  });
});

describe("the sign-in screen is only for signed-out visitors", () => {
  const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const login = readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8");
  it("/ shows LoginForm only when there is no user", () => {
    assert.match(home, /if \(!user\) \{\s*(\/\/[^\n]*\s*)?return <LoginForm \/>;/);
  });
  it("the founding-offer pop-up is switched off: neither / nor /login passes showOffer", () => {
    assert.doesNotMatch(home, /<LoginForm[^>]*showOffer/);
    assert.doesNotMatch(login, /showOffer/);
  });
  it("/login sends a signed-in user straight on", () => {
    assert.match(login, /if \(auth\.user\) redirect\(next\);/);
  });
});

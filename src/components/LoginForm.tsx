"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePendingAction } from "@/lib/use-pending-action";
import { useBackHandler } from "./AppChrome";
import { Logo } from "./Logo";
import { PendingLabel } from "./Pending";

type Step = "choice" | "enter-phone" | "enter-code";
type Intent = "signup" | "signin";

/**
 * Phone number is collected as an 8-digit local Singapore number and
 * normalized to E.164 (+65XXXXXXXX) before hitting Supabase — that's the
 * format Supabase/Vonage require. Adjust the prefix here if Kopi Boy
 * expands beyond Singapore.
 */
const SG_PREFIX = "+65";

export function LoginForm({ initialError = null }: { initialError?: string | null }) {
  const [step, setStep] = useState<Step>("choice");
  const [intent, setIntent] = useState<Intent>("signin");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  // Google, send-code and verify share one busy state: none can start while another runs.
  const { busy, isRunning, run, startTransition } = usePendingAction();

  const supabase = createClient();
  const router = useRouter();

  const fullPhone = `${SG_PREFIX}${phone.replace(/\D/g, "")}`;

  // Global Back steps back through the flow: code -> phone -> Sign in / Sign up choice.
  useBackHandler(
    step === "enter-code"
      ? () => setStep("enter-phone")
      : step === "enter-phone"
        ? () => {
            setStep("choice");
            setError(null);
          }
        : null,
  );

  function chooseIntent(next: Intent) {
    setError(null);
    if (step === "enter-code") {
      // A code already sent was issued for the other intent (sign in never
      // creates an account, sign up may) — switching means sending a new one.
      if (next === intent) return;
      setCode("");
      setStep("enter-phone");
    }
    setIntent(next);
    if (step === "choice") setStep("enter-phone");
  }

  function handleGoogleSignIn() {
    run("google", async () => {
      setError(null);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        setError(error.message);
        return;
      }
      // On success the browser is navigating away to Google — stay busy until it does.
      await new Promise<never>(() => {});
    });
  }

  function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    run("send", async () => {
      setError(null);
      // Sign in only works for an existing account; only Sign up may create one.
      // Without this, a mistyped number on "Sign in" would silently create a
      // brand-new account instead of telling the user.
      const { error } = await supabase.auth.signInWithOtp({
        phone: fullPhone,
        options: { shouldCreateUser: intent === "signup" },
      });
      if (error) {
        if (intent === "signin" && (error.code === "otp_disabled" || /signups? not allowed/i.test(error.message))) {
          setError("We couldn't find an account for that number. Check the number, or tap Sign up if you're new.");
        } else {
          setError(error.message);
        }
        return;
      }
      setStep("enter-code");
    });
  }

  function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    run("verify", async () => {
      setError(null);
      const { error } = await supabase.auth.verifyOtp({ phone: fullPhone, token: code, type: "sms" });
      if (error) {
        setError(error.message);
        return;
      }
      startTransition(() => {
        router.push("/");
        router.refresh();
      });
    });
  }

  return (
    <div className="mx-auto flex min-h-page max-w-sm flex-col justify-center px-6" style={{ background: "var(--kb-navy)" }}>
      <div className="mb-8 flex justify-center">
        <Logo size={56} />
      </div>

      {step === "choice" ? (
        <div className="space-y-3">
          <h1 className="text-center font-display text-lg font-bold" style={{ color: "var(--kb-on-navy)" }}>
            Kopi Boy Partners
          </h1>
          <p className="mb-3 text-center text-sm" style={{ color: "var(--kb-on-navy-soft)" }}>
            Cook, deliver or pick up with Kopi Boy.
          </p>
          <button
            onClick={() => chooseIntent("signin")}
            className="w-full rounded-2xl bg-white px-5 py-3.5 text-left shadow-lg"
            style={{ color: "var(--kb-ink)" }}
          >
            <span className="block text-[15px] font-semibold">Sign in</span>
            <span className="block text-xs" style={{ color: "var(--kb-ink-soft)" }}>
              I already have an account
            </span>
          </button>
          <button
            onClick={() => chooseIntent("signup")}
            className="w-full rounded-2xl px-5 py-3.5 text-left text-white"
            style={{ background: "linear-gradient(90deg, var(--kb-purple) 0%, var(--kb-green) 100%)" }}
          >
            <span className="block text-[15px] font-semibold">Sign up</span>
            <span className="block text-xs opacity-90">I&apos;m new — create a partner account</span>
          </button>
        </div>
      ) : (
        <>
          {/* Both options stay on screen for every step of the flow. */}
          <div
            role="group"
            aria-label="Sign in or sign up"
            className="mb-5 grid grid-cols-2 gap-1 rounded-2xl p-1"
            style={{ background: "var(--kb-navy-raised)" }}
          >
            {(["signin", "signup"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={intent === option}
                onClick={() => chooseIntent(option)}
                className="rounded-xl py-2 text-sm font-semibold"
                style={
                  intent === option
                    ? { background: "white", color: "var(--kb-ink)" }
                    : { color: "var(--kb-on-navy-soft)" }
                }
              >
                {option === "signin" ? "Sign in" : "Sign up"}
              </button>
            ))}
          </div>


          <h1 className="text-center font-display text-lg font-bold" style={{ color: "var(--kb-on-navy)" }}>
            {intent === "signup" ? "Create your partner account" : "Welcome back"}
          </h1>
          <p className="mb-5 mt-1 text-center text-sm" style={{ color: "var(--kb-on-navy-soft)" }}>
            {intent === "signup"
              ? "New to Kopi Boy? Sign up with Google or your mobile number."
              : "Sign in with the Google account or mobile number you used before."}
          </p>

          <button
            onClick={handleGoogleSignIn}
            disabled={busy}
            className="flex items-center justify-center gap-3 rounded-2xl bg-white py-3.5 text-[15px] font-semibold shadow-lg disabled:opacity-60"
            style={{ color: "var(--kb-ink)" }}
          >
            <PendingLabel pending={isRunning("google")} pendingText="Redirecting…">
              <GoogleIcon />
              {intent === "signup" ? "Sign up with Google" : "Sign in with Google"}
            </PendingLabel>
          </button>

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1" style={{ background: "var(--kb-navy-line)" }} />
            <span className="text-xs" style={{ color: "var(--kb-on-navy-soft)" }}>or</span>
            <span className="h-px flex-1" style={{ background: "var(--kb-navy-line)" }} />
          </div>

          {step === "enter-phone" ? (
            <form onSubmit={handleSendCode} className="space-y-3">
              <div
                className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3.5"
                style={{ color: "var(--kb-ink)" }}
              >
                <span className="text-[15px] font-medium" style={{ color: "var(--kb-ink-soft)" }}>
                  {SG_PREFIX}
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  placeholder="9123 4567"
                  className="w-full bg-transparent text-[15px] outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={busy || phone.length < 8}
                className="w-full rounded-2xl py-3.5 text-[15px] font-semibold text-white disabled:opacity-60"
                style={{ background: "linear-gradient(90deg, var(--kb-purple) 0%, var(--kb-green) 100%)" }}
              >
                <PendingLabel pending={isRunning("send")} pendingText="Sending code…">
                  {intent === "signup" ? "Send sign-up code" : "Send sign-in code"}
                </PendingLabel>
              </button>
              <p className="pt-1 text-center text-sm" style={{ color: "var(--kb-on-navy-soft)" }}>
                {intent === "signin" ? "New to Kopi Boy? " : "Already have an account? "}
                <button
                  type="button"
                  onClick={() => chooseIntent(intent === "signin" ? "signup" : "signin")}
                  className="font-semibold underline"
                  style={{ color: "var(--kb-green)" }}
                >
                  {intent === "signin" ? "Sign up" : "Sign in"}
                </button>
              </p>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode} className="space-y-3">
              <p className="text-sm" style={{ color: "var(--kb-on-navy-soft)" }}>
                Enter the 6-digit code we sent to <span style={{ color: "var(--kb-on-navy)" }}>{fullPhone}</span>.
              </p>
              <input
                type="text"
                inputMode="numeric"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                className="w-full rounded-2xl bg-white px-4 py-3.5 text-center text-lg tracking-[0.3em] outline-none"
                style={{ color: "var(--kb-ink)" }}
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-2xl py-3.5 text-[15px] font-semibold text-white disabled:opacity-60"
                style={{ background: "linear-gradient(90deg, var(--kb-purple) 0%, var(--kb-green) 100%)" }}
              >
                <PendingLabel pending={isRunning("verify")} pendingText="Verifying…">Verify & continue</PendingLabel>
              </button>
              <button
                type="button"
                onClick={() => setStep("enter-phone")}
                className="w-full text-center text-sm"
                style={{ color: "var(--kb-on-navy-soft)" }}
              >
                Use a different number
              </button>
            </form>
          )}
        </>
      )}

      {error && (
        <p className="mt-4 rounded-xl px-3 py-2 text-sm" style={{ background: "rgba(239,68,68,0.15)", color: "#FCA5A5" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

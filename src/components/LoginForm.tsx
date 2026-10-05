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

const SG_PREFIX = "+65";

export function LoginForm({
  initialError = null,
}: {
  initialError?: string | null;
}) {
  const [step, setStep] = useState<Step>("choice");
  const [intent, setIntent] = useState<Intent>("signin");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(initialError);

  const { busy, isRunning, run, startTransition } = usePendingAction();

  const supabase = createClient();
  const router = useRouter();

  const fullPhone = `${SG_PREFIX}${phone.replace(/\D/g, "")}`;

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
      if (next === intent) return;

      setCode("");
      setStep("enter-phone");
    }

    setIntent(next);

    if (step === "choice") {
      setStep("enter-phone");
    }
  }

  function handleGoogleSignIn() {
    run("google", async () => {
      setError(null);

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        setError(error.message);
        return;
      }

      await new Promise<never>(() => {});
    });
  }

  function handleSendCode(e: React.FormEvent) {
    e.preventDefault();

    run("send", async () => {
      setError(null);

      const { error } = await supabase.auth.signInWithOtp({
        phone: fullPhone,
        options: {
          shouldCreateUser: intent === "signup",
        },
      });

      if (error) {
        if (
          intent === "signin" &&
          (error.code === "otp_disabled" ||
            /signups? not allowed/i.test(error.message))
        ) {
          setError(
            "We couldn't find an account for that number. Check the number, or tap Sign up if you're new.",
          );
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

      const { error } = await supabase.auth.verifyOtp({
        phone: fullPhone,
        token: code,
        type: "sms",
      });

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
    <main className="relative min-h-page overflow-hidden bg-white">
      {/* Ferrari background atmosphere */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 0%, rgba(124,58,237,0.16), transparent 38%), radial-gradient(circle at 100% 100%, rgba(20,184,166,0.10), transparent 35%)",
        }}
      />

      <div className="relative mx-auto flex min-h-page w-full max-w-md flex-col justify-center px-5 py-8">
        {/* Kopi Boy logo */}
        <div className="mb-7 flex justify-center">
          <Logo size={58} />
        </div>

        {/* Header */}
        <div className="mb-7 text-center">
          <div
            className="mb-2 inline-flex rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em]"
            style={{
              background: "rgba(124,58,237,0.08)",
              color: "var(--kb-purple)",
            }}
          >
            Partner Portal
          </div>

          <h1
            className="font-display text-3xl font-bold tracking-tight"
            style={{ color: "var(--kb-ink)" }}
          >
            Kopi Boy Partners
          </h1>

          <p
            className="mt-2 text-sm leading-6"
            style={{ color: "var(--kb-ink-soft)" }}
          >
            Cook, deliver or pick up with Kopi Boy.
          </p>
        </div>

        {/* Main Ferrari card */}
        <div
          className="rounded-[28px] border bg-white p-5 shadow-[0_20px_60px_rgba(30,20,60,0.10)]"
          style={{
            borderColor: "rgba(124,58,237,0.10)",
          }}
        >
          {step === "choice" ? (
            <div className="space-y-3">
              <div className="mb-4">
                <p
                  className="text-sm font-semibold"
                  style={{ color: "var(--kb-ink)" }}
                >
                  Welcome to the partner network
                </p>

                <p
                  className="mt-1 text-xs leading-5"
                  style={{ color: "var(--kb-ink-soft)" }}
                >
                  Choose how you want to continue.
                </p>
              </div>

              {/* Sign in */}
              <button
                onClick={() => chooseIntent("signin")}
                className="group w-full rounded-2xl border px-5 py-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                style={{
                  borderColor: "rgba(124,58,237,0.12)",
                  background: "white",
                  color: "var(--kb-ink)",
                }}
              >
                <span className="flex items-center justify-between">
                  <span>
                    <span className="block text-[15px] font-bold">
                      Sign in
                    </span>

                    <span
                      className="mt-1 block text-xs"
                      style={{ color: "var(--kb-ink-soft)" }}
                    >
                      I already have an account
                    </span>
                  </span>

                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-full"
                    style={{
                      background: "rgba(124,58,237,0.08)",
                      color: "var(--kb-purple)",
                    }}
                  >
                    →
                  </span>
                </span>
              </button>

              {/* Sign up */}
              <button
                onClick={() => chooseIntent("signup")}
                className="w-full rounded-2xl px-5 py-4 text-left text-white shadow-lg transition-all hover:-translate-y-0.5"
                style={{
                  background:
                    "linear-gradient(135deg, var(--kb-purple) 0%, #8b5cf6 48%, var(--kb-green) 100%)",
                }}
              >
                <span className="flex items-center justify-between">
                  <span>
                    <span className="block text-[15px] font-bold">
                      Sign up
                    </span>

                    <span className="mt-1 block text-xs opacity-90">
                      I&apos;m new — create a partner account
                    </span>
                  </span>

                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-lg">
                    →
                  </span>
                </span>
              </button>
            </div>
          ) : (
            <>
              {/* Sign in / Sign up switcher */}
              <div
                role="group"
                aria-label="Sign in or sign up"
                className="mb-5 grid grid-cols-2 gap-1 rounded-2xl p-1"
                style={{
                  background: "#F5F3FA",
                }}
              >
                {(["signin", "signup"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={intent === option}
                    onClick={() => chooseIntent(option)}
                    className="rounded-xl py-2.5 text-sm font-semibold transition-all"
                    style={
                      intent === option
                        ? {
                            background: "white",
                            color: "var(--kb-ink)",
                            boxShadow:
                              "0 3px 12px rgba(30,20,60,0.08)",
                          }
                        : {
                            color: "var(--kb-ink-soft)",
                          }
                    }
                  >
                    {option === "signin" ? "Sign in" : "Sign up"}
                  </button>
                ))}
              </div>

              {/* Title */}
              <div className="mb-5">
                <h2
                  className="text-xl font-bold tracking-tight"
                  style={{ color: "var(--kb-ink)" }}
                >
                  {intent === "signup"
                    ? "Create your partner account"
                    : "Welcome back"}
                </h2>

                <p
                  className="mt-1.5 text-sm leading-5"
                  style={{ color: "var(--kb-ink-soft)" }}
                >
                  {intent === "signup"
                    ? "New to Kopi Boy? Join the partner network."
                    : "Sign in with Google or your mobile number."}
                </p>
              </div>

              {/* Google */}
              <button
                onClick={handleGoogleSignIn}
                disabled={busy}
                className="flex w-full items-center justify-center gap-3 rounded-2xl border bg-white py-3.5 text-[15px] font-semibold shadow-sm transition-all hover:shadow-md disabled:opacity-60"
                style={{
                  borderColor: "rgba(30,20,60,0.10)",
                  color: "var(--kb-ink)",
                }}
              >
                <PendingLabel
                  pending={isRunning("google")}
                  pendingText="Redirecting…"
                >
                  <GoogleIcon />

                  {intent === "signup"
                    ? "Sign up with Google"
                    : "Sign in with Google"}
                </PendingLabel>
              </button>

              {/* Divider */}
              <div className="my-5 flex items-center gap-3">
                <span
                  className="h-px flex-1"
                  style={{ background: "#EAE7F0" }}
                />

                <span
                  className="text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--kb-ink-soft)" }}
                >
                  or mobile
                </span>

                <span
                  className="h-px flex-1"
                  style={{ background: "#EAE7F0" }}
                />
              </div>

              {/* Phone */}
              {step === "enter-phone" ? (
                <form onSubmit={handleSendCode} className="space-y-3">
                  <div
                    className="flex items-center gap-2 rounded-2xl border bg-[#FAFAFC] px-4 py-3.5"
                    style={{
                      borderColor: "rgba(124,58,237,0.12)",
                      color: "var(--kb-ink)",
                    }}
                  >
                    <span
                      className="text-[15px] font-semibold"
                      style={{ color: "var(--kb-ink-soft)" }}
                    >
                      {SG_PREFIX}
                    </span>

                    <input
                      type="tel"
                      inputMode="numeric"
                      required
                      value={phone}
                      onChange={(e) =>
                        setPhone(
                          e.target.value.replace(/\D/g, "").slice(0, 8),
                        )
                      }
                      placeholder="9123 4567"
                      className="w-full bg-transparent text-[15px] outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={busy || phone.length < 8}
                    className="w-full rounded-2xl py-3.5 text-[15px] font-bold text-white shadow-lg transition-all disabled:opacity-60"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--kb-purple) 0%, #8b5cf6 48%, var(--kb-green) 100%)",
                    }}
                  >
                    <PendingLabel
                      pending={isRunning("send")}
                      pendingText="Sending code…"
                    >
                      {intent === "signup"
                        ? "Send sign-up code"
                        : "Send sign-in code"}
                    </PendingLabel>
                  </button>

                  <p
                    className="pt-1 text-center text-sm"
                    style={{ color: "var(--kb-ink-soft)" }}
                  >
                    {intent === "signin"
                      ? "New to Kopi Boy? "
                      : "Already have an account? "}

                    <button
                      type="button"
                      onClick={() =>
                        chooseIntent(
                          intent === "signin" ? "signup" : "signin",
                        )
                      }
                      className="font-bold underline"
                      style={{ color: "var(--kb-purple)" }}
                    >
                      {intent === "signin" ? "Sign up" : "Sign in"}
                    </button>
                  </p>
                </form>
              ) : (
                <form onSubmit={handleVerifyCode} className="space-y-3">
                  <p
                    className="text-sm leading-6"
                    style={{ color: "var(--kb-ink-soft)" }}
                  >
                    Enter the 6-digit code we sent to{" "}
                    <span
                      className="font-semibold"
                      style={{ color: "var(--kb-ink)" }}
                    >
                      {fullPhone}
                    </span>
                    .
                  </p>

                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                    className="w-full rounded-2xl border bg-[#FAFAFC] px-4 py-4 text-center text-lg tracking-[0.3em] outline-none"
                    style={{
                      borderColor: "rgba(124,58,237,0.12)",
                      color: "var(--kb-ink)",
                    }}
                  />

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full rounded-2xl py-3.5 text-[15px] font-bold text-white shadow-lg disabled:opacity-60"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--kb-purple) 0%, #8b5cf6 48%, var(--kb-green) 100%)",
                    }}
                  >
                    <PendingLabel
                      pending={isRunning("verify")}
                      pendingText="Verifying…"
                    >
                      Verify & continue
                    </PendingLabel>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStep("enter-phone")}
                    className="w-full py-2 text-center text-sm font-medium"
                    style={{ color: "var(--kb-ink-soft)" }}
                  >
                    ← Use a different number
                  </button>
                </form>
              )}
            </>
          )}

          {/* Error */}
          {error && (
            <p
              className="mt-4 rounded-2xl border px-4 py-3 text-sm"
              style={{
                borderColor: "rgba(239,68,68,0.15)",
                background: "rgba(239,68,68,0.06)",
                color: "#DC2626",
              }}
            >
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.2em]"
            style={{ color: "var(--kb-ink-soft)" }}
          >
            KOPI BOY • PARTNER NETWORK
          </p>
        </div>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
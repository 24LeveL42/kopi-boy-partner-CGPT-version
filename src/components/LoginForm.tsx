"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePendingAction } from "@/lib/use-pending-action";
import { useBackHandler } from "./AppChrome";
import { Logo } from "./Logo";
import { PendingLabel } from "./Pending";

// Google is the only sign-in method (phone/SMS codes were removed).
type Step = "choice" | "google";
type Intent = "signup" | "signin";

export function LoginForm({
  initialError = null,
}: {
  initialError?: string | null;
}) {
  const [step, setStep] = useState<Step>("choice");
  const [intent, setIntent] = useState<Intent>("signin");
  const [error, setError] = useState<string | null>(initialError);

  const { busy, isRunning, run } = usePendingAction();

  const supabase = createClient();

  useBackHandler(
    step === "google"
      ? () => {
          setStep("choice");
          setError(null);
        }
      : null,
  );

  function chooseIntent(next: Intent) {
    setError(null);
    setIntent(next);
    setStep("google");
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
                    : "Sign in with Google."}
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
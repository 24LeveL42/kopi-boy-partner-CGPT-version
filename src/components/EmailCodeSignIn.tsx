"use client";

import { useEffect, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import { usePendingAction } from "@/lib/use-pending-action";
import {
  EMAIL_CODE_COPY,
  EMAIL_CODE_ERRORS,
  MAX_CODE_LENGTH,
  cleanCode,
  isCompleteCode,
  isValidEmail,
  normalizeEmail,
  otpOptions,
  resendSecondsLeft,
  sendCodeError,
  verifyCodeError,
  type EmailCodeErrorCode,
  type EmailIntent,
} from "@/lib/email-otp";
import type { RegistrationEvent } from "@/lib/registration-tracking";
import { PendingLabel } from "./Pending";

/**
 * Email one-time-code sign-in, shown inside in-app browsers (see
 * src/lib/email-otp.ts). LoginForm owns the step ("email" → "code") so the
 * app bar's Back steps through it; this component keeps the typed email.
 */
export function EmailCodeSignIn({
  supabase,
  intent,
  next,
  stage,
  onStageChange,
  track,
  flush,
}: {
  supabase: ReturnType<typeof createClient>;
  intent: EmailIntent;
  /** Safe relative path to land on once signed in. */
  next: string;
  stage: "email" | "code";
  onStageChange: (stage: "email" | "code") => void;
  track: (e: RegistrationEvent) => void;
  flush: () => void;
}) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { busy, isRunning, run } = usePendingAction();

  const waitLeft = resendSecondsLeft(sentAt, now);
  // Ticks only while the Resend wait is running.
  useEffect(() => {
    if (waitLeft <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waitLeft]);

  function fail(code: EmailCodeErrorCode) {
    track({ event: "email_code_error", code });
    setError(EMAIL_CODE_ERRORS[code]);
  }

  async function sendCode(to: string): Promise<boolean> {
    const { error: sendError } = await supabase.auth.signInWithOtp({ email: to, options: otpOptions(intent) });
    const problem = sendCodeError(sendError, intent);
    if (problem) {
      if (problem === "send_failed") console.error("EmailCodeSignIn: couldn't send code", sendError);
      fail(problem);
      return false;
    }
    track({ event: "email_code_sent" });
    const t = Date.now();
    setSentAt(t);
    setNow(t);
    return true;
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const to = normalizeEmail(email);
    if (!isValidEmail(to)) {
      fail("invalid_email");
      return;
    }
    run("send", async () => {
      if (await sendCode(to)) {
        setSentTo(to);
        setCode("");
        onStageChange("code");
      }
    });
  }

  function handleResend() {
    if (waitLeft > 0 || !sentTo) return;
    setError(null);
    setNotice(null);
    run("resend", async () => {
      if (await sendCode(sentTo)) {
        setCode("");
        setNotice(EMAIL_CODE_COPY.resent);
      }
    });
  }

  function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!isCompleteCode(code)) {
      setError(EMAIL_CODE_COPY.incompleteCode);
      return;
    }
    run("verify", async () => {
      const { error: verifyError } = await supabase.auth.verifyOtp({ email: sentTo, token: code, type: "email" });
      const problem = verifyCodeError(verifyError);
      if (problem) {
        if (problem === "verify_failed") console.error("EmailCodeSignIn: couldn't verify code", verifyError);
        fail(problem);
        return;
      }
      // Signed in (the session cookie is set). A full load lets the server
      // see it, as after Google's /auth/callback. Stays busy until it leaves.
      flush();
      window.location.assign(next);
      await new Promise<void>((resolve) => setTimeout(resolve, 15_000));
    });
  }

  function useDifferentEmail() {
    setError(null);
    setNotice(null);
    setCode("");
    onStageChange("email");
  }

  return (
    <div>
      {stage === "email" ? (
        <form onSubmit={handleSend} noValidate className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold" style={{ color: "var(--kb-ink)" }}>
              {EMAIL_CODE_COPY.emailLabel}
            </span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="kb-input"
              placeholder="you@example.com"
            />
          </label>
          <p className="text-xs leading-5" style={{ color: "var(--kb-ink-soft)" }}>
            {EMAIL_CODE_COPY.hint}
          </p>
          <button type="submit" disabled={busy} className="kb-btn-primary w-full py-3.5 text-[15px]">
            <PendingLabel pending={isRunning("send")} pendingText={EMAIL_CODE_COPY.sending}>
              {EMAIL_CODE_COPY.sendCode}
            </PendingLabel>
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerify} noValidate className="space-y-3">
          <p className="text-sm leading-6" style={{ color: "var(--kb-ink)" }}>
            {EMAIL_CODE_COPY.sentTo} <span className="break-all font-bold">{sentTo}</span>.
          </p>
          <p className="text-xs leading-5" style={{ color: "var(--kb-ink-soft)" }}>
            {EMAIL_CODE_COPY.checkSpam}
          </p>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold" style={{ color: "var(--kb-ink)" }}>
              {EMAIL_CODE_COPY.codeLabel}
            </span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={MAX_CODE_LENGTH}
              value={code}
              onChange={(e) => setCode(cleanCode(e.target.value))}
              className="kb-input text-center text-lg font-bold tracking-[0.3em]"
            />
          </label>
          <button type="submit" disabled={busy} className="kb-btn-primary w-full py-3.5 text-[15px]">
            <PendingLabel pending={isRunning("verify")} pendingText={EMAIL_CODE_COPY.verifying}>
              {EMAIL_CODE_COPY.verify}
            </PendingLabel>
          </button>
          <div className="flex items-center justify-between gap-3 text-sm">
            <button type="button" onClick={useDifferentEmail} disabled={busy} className="font-semibold underline-offset-2 hover:underline" style={{ color: "var(--kb-ink-soft)" }}>
              {EMAIL_CODE_COPY.differentEmail}
            </button>
            <button
              type="button"
              onClick={handleResend}
              disabled={busy || waitLeft > 0}
              aria-live="polite"
              className="font-semibold underline-offset-2 hover:underline disabled:no-underline disabled:opacity-60"
              style={{ color: "var(--kb-purple)" }}
            >
              <PendingLabel pending={isRunning("resend")} pendingText={EMAIL_CODE_COPY.sending}>
                {waitLeft > 0 ? EMAIL_CODE_COPY.resendIn(waitLeft) : EMAIL_CODE_COPY.resend}
              </PendingLabel>
            </button>
          </div>
        </form>
      )}

      {notice && !error && (
        <p className="mt-3 rounded-2xl px-4 py-3 text-sm" role="status" style={{ background: "rgba(20,184,166,0.08)", color: "var(--kb-ink)" }}>
          {notice}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-2xl border px-4 py-3 text-sm"
          style={{ borderColor: "rgba(239,68,68,0.15)", background: "rgba(239,68,68,0.06)", color: "#DC2626" }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { ClaimResultStatus } from "@/lib/assisted-claim";
import { RESUME_COPY, RESUME_NO_TOKEN_COPY, RESUME_STATUS_COPY } from "@/lib/claim-copy";
import { Frame, Message } from "./ClaimFlow";

/**
 * HQ's sign-in link for an owner whose shop is already claimed:
 * /resume#<token>. Reads the token from the # fragment once, takes it out of
 * the address bar and keeps it only in memory. Nothing is sent until the
 * owner taps "Sign me in": that POST is the only request that carries the
 * token (it is used up there). Never logs it.
 *
 * Plain fetch + full-page navigation, as on /claim, so it behaves the same in
 * WhatsApp's in-app browser, Chrome and Safari.
 */

type View = { kind: "loading" } | { kind: "no-token" } | { kind: "ready" } | { kind: "message"; status: Exclude<ClaimResultStatus, "ok"> };

export function ResumeFlow() {
  const tokenRef = useRef<string | null>(null);
  const [view, setView] = useState<View>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [errorShown, setErrorShown] = useState(false);

  useEffect(() => {
    const token = window.location.hash.replace(/^#/, "").trim();
    // Out of the address bar (and so out of history, screenshots and shares) before anything else.
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    tokenRef.current = token || null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of the fragment on mount
    setView(token ? { kind: "ready" } : { kind: "no-token" });
  }, []);

  async function signIn() {
    const token = tokenRef.current;
    if (!token || busy) return;
    setBusy(true);
    let status: ClaimResultStatus = "error";
    try {
      const res = await fetch("/api/claim/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
        credentials: "same-origin",
      });
      const body = (await res.json().catch(() => null)) as { status?: ClaimResultStatus } | null;
      status = res.status === 429 ? "rate_limited" : body?.status ?? "error";
    } catch {
      status = "error";
    }
    if (status === "ok") {
      tokenRef.current = null;
      // A full load, so the new session cookies are used from the first request.
      window.location.replace("/kitchen");
      return;
    }
    setBusy(false);
    // Our own error: the owner can tap again (a used-up link then says so).
    if (status === "error") {
      setErrorShown(true);
      return;
    }
    tokenRef.current = null;
    setView({ kind: "message", status });
  }

  if (view.kind === "loading") {
    return (
      <Frame>
        <p className="py-16 text-center text-lg" style={{ color: "var(--kb-ink-soft)" }} role="status">
          Opening…
        </p>
      </Frame>
    );
  }

  if (view.kind === "no-token") {
    return (
      <Frame>
        <Message title={RESUME_NO_TOKEN_COPY.title} message={RESUME_NO_TOKEN_COPY.message} />
      </Frame>
    );
  }

  if (view.kind === "message") {
    const copy = RESUME_STATUS_COPY[view.status];
    return (
      <Frame>
        <Message title={copy.title} message={copy.message} />
      </Frame>
    );
  }

  return (
    <Frame>
      <p className="text-center text-sm font-bold uppercase tracking-[0.14em]" style={{ color: "var(--kb-purple)" }}>
        {RESUME_COPY.eyebrow}
      </p>
      <h1 className="mt-2 text-center font-display text-3xl font-bold leading-tight" style={{ color: "var(--kb-ink)" }}>
        {RESUME_COPY.title}
      </h1>
      <p className="kb-card mt-6 p-5 text-lg leading-8" style={{ color: "var(--kb-ink)" }}>
        {RESUME_COPY.message}
      </p>
      {errorShown ? (
        <p className="mt-4 rounded-2xl px-4 py-3 text-base font-semibold" role="alert" style={{ background: "#FEF2F2", color: "#991B1B" }}>
          {RESUME_STATUS_COPY.error.message}
        </p>
      ) : null}
      <button type="button" onClick={signIn} disabled={busy} className="kb-btn-primary mt-6 w-full py-4 text-xl">
        {busy ? RESUME_COPY.busy : RESUME_COPY.button}
      </button>
    </Frame>
  );
}

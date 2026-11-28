"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Logo } from "./Logo";
import { MERCHANT_CATEGORIES } from "@/lib/kitchen-profile";
import type { ClaimItem, ClaimResultStatus, ClaimShop } from "@/lib/assisted-claim";
import { isStandaloneApp } from "@/lib/standalone-app";
import { KITCHEN_UEN_COPY, claimShowsUenLine } from "@/lib/kitchen-uen";
import {
  CLAIM_BUTTON,
  CLAIM_STATUS_COPY,
  NO_TOKEN_COPY,
  PARTNER_TERMS_SENTENCE,
  READ_TICK,
  SIGNED_OUT_OWNER_COPY,
  TICK_HINT,
  canClaimShop,
  claimStatement,
  formatPrice,
} from "@/lib/claim-copy";

/**
 * The owner's claim screen. Reads the token from the # fragment once, takes
 * it out of the address bar (history.replaceState) and keeps it only in
 * memory. Never logs it.
 *
 * Plain fetch + full-page navigation (no router tricks), so it behaves the
 * same in WhatsApp's in-app browser, Chrome and Safari.
 */

type View =
  | { kind: "loading" }
  | { kind: "no-token"; standalone: boolean }
  | { kind: "message"; status: Exclude<ClaimResultStatus, "ok"> }
  | { kind: "preview"; shop: ClaimShop; items: ClaimItem[] };

const CUISINES: Record<string, string> = { chinese: "Chinese", halal: "Halal", indian: "Indian", western: "Western" };

async function post(path: string, token: string): Promise<{ status: ClaimResultStatus } & Record<string, unknown>> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      cache: "no-store",
      credentials: "same-origin",
    });
    const body = (await res.json().catch(() => null)) as { status?: ClaimResultStatus } | null;
    if (res.status === 429) return { status: "rate_limited" };
    return body?.status ? (body as { status: ClaimResultStatus }) : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

export function ClaimFlow({ terms, privacy }: { terms: ReactNode; privacy: ReactNode }) {
  const tokenRef = useRef<string | null>(null);
  const [view, setView] = useState<View>({ kind: "loading" });
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorShown, setErrorShown] = useState(false);

  useEffect(() => {
    const token = window.location.hash.replace(/^#/, "").trim();
    // Out of the address bar (and so out of history, screenshots and shares) before anything else.
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    let cancelled = false;
    (async () => {
      if (!token) {
        if (!cancelled) setView({ kind: "no-token", standalone: isStandaloneApp() });
        return;
      }
      tokenRef.current = token;
      const result = await post("/api/claim/preview", token);
      if (cancelled) return;
      if (result.status === "ok" && result.shop) {
        setView({ kind: "preview", shop: result.shop as ClaimShop, items: (result.items as ClaimItem[]) ?? [] });
      } else {
        tokenRef.current = null;
        setView({ kind: "message", status: result.status === "ok" ? "error" : result.status });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function claim() {
    const token = tokenRef.current;
    if (!token || busy) return;
    setBusy(true);
    const result = await post("/api/claim/complete", token);
    if (result.status === "ok") {
      tokenRef.current = null;
      // A full load, so the new session cookies are used from the first request.
      window.location.replace("/kitchen");
      return;
    }
    setBusy(false);
    // Our own error (nothing was saved): the owner can tap again. Any link status ends here.
    if (result.status === "error") {
      setErrorShown(true);
      return;
    }
    tokenRef.current = null;
    setView({ kind: "message", status: result.status });
  }

  if (view.kind === "loading") {
    return (
      <Frame>
        <p className="py-16 text-center text-lg" style={{ color: "var(--kb-ink-soft)" }} role="status">
          Opening your shop…
        </p>
      </Frame>
    );
  }

  if (view.kind === "no-token") {
    const copy = view.standalone ? SIGNED_OUT_OWNER_COPY : NO_TOKEN_COPY;
    return (
      <Frame>
        <Message title={copy.title} message={copy.message} />
      </Frame>
    );
  }

  if (view.kind === "message") {
    const copy = CLAIM_STATUS_COPY[view.status];
    return (
      <Frame>
        <Message title={copy.title} message={copy.message} />
      </Frame>
    );
  }

  const { shop, items } = view;
  const category = MERCHANT_CATEGORIES.find((c) => c.id === shop.category)?.label ?? shop.category;
  const canClaim = canClaimShop({ ticked, busy });

  return (
    <Frame>
      <p className="text-center text-sm font-bold uppercase tracking-[0.14em]" style={{ color: "var(--kb-purple)" }}>
        Kopi Boy set up your shop
      </p>
      <h1 className="mt-2 text-center font-display text-3xl font-bold leading-tight" style={{ color: "var(--kb-ink)" }}>
        {shop.business_name}
      </h1>

      <section className="kb-card mt-6 space-y-3 p-5 text-lg">
        {shop.hero_image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shop.hero_image} alt="" className="h-44 w-full rounded-2xl object-cover" />
        ) : null}
        <Detail label="Owner" value={shop.owner_name} />
        {shop.owner_mobile_masked ? <Detail label="Mobile" value={shop.owner_mobile_masked} /> : null}
        <Detail label="Type" value={[category, CUISINES[shop.cuisine_type] ?? shop.cuisine_type, shop.is_halal ? "Halal" : null].filter(Boolean).join(" · ")} />
        {shop.business_address ? (
          <Detail label="Address" value={[shop.business_address, shop.postal_code].filter(Boolean).join(" ")} />
        ) : null}
        {shop.business_uen ? <Detail label="UEN" value={shop.business_uen} /> : null}
        {claimShowsUenLine(shop) ? (
          <p className="text-base leading-7" style={{ color: "var(--kb-ink)" }}>{KITCHEN_UEN_COPY.claimLine}</p>
        ) : null}
        {shop.description ? <p className="text-base leading-7" style={{ color: "var(--kb-ink-soft)" }}>{shop.description}</p> : null}
      </section>

      <section className="kb-card mt-4 p-5">
        <h2 className="font-display text-xl font-bold" style={{ color: "var(--kb-ink)" }}>Your menu</h2>
        {items.length === 0 ? (
          <p className="mt-2 text-base" style={{ color: "var(--kb-ink-soft)" }}>No dishes yet. You can add them after you claim your shop.</p>
        ) : (
          <ul className="mt-3 divide-y" style={{ borderColor: "var(--kb-line)" }}>
            {items.map((item, i) => (
              <li key={i} className="flex items-center gap-3 py-3">
                {item.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.photo_url} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                ) : null}
                <span className="min-w-0 flex-1 text-lg" style={{ color: "var(--kb-ink)" }}>{item.name}</span>
                <span className="shrink-0 text-lg font-bold" style={{ color: "var(--kb-ink)" }}>{formatPrice(item.price)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm" style={{ color: "var(--kb-ink-soft)" }}>You can change your menu and prices any time.</p>
      </section>

      <section className="mt-6">
        <h2 className="font-display text-xl font-bold" style={{ color: "var(--kb-ink)" }}>Please read</h2>
        <div
          tabIndex={0}
          aria-label="Terms of Use and Privacy Policy"
          className="kb-card mt-3 max-h-[60vh] overflow-y-auto overscroll-contain p-5"
        >
          {terms}
          <hr className="my-8" style={{ borderColor: "var(--kb-line)" }} />
          {privacy}
        </div>
      </section>

      <p className="kb-card mt-6 p-5 text-lg leading-8" style={{ color: "var(--kb-ink)" }}>
        {PARTNER_TERMS_SENTENCE}
      </p>

      <label className="mt-4 flex min-h-12 items-center gap-3 px-1 text-lg" style={{ color: "var(--kb-ink)" }}>
        <input
          type="checkbox"
          checked={ticked}
          onChange={(e) => setTicked(e.target.checked)}
          className="h-6 w-6 shrink-0 accent-[#7B3FE4]"
        />
        <span>{READ_TICK}</span>
      </label>

      <p className="mt-5 text-lg leading-8 font-semibold" style={{ color: "var(--kb-ink)" }}>
        {claimStatement(shop.business_name)}
      </p>

      {!ticked ? (
        <p className="mt-3 text-base" style={{ color: "var(--kb-ink-soft)" }}>{TICK_HINT}</p>
      ) : null}
      {errorShown ? (
        <p className="mt-3 rounded-2xl px-4 py-3 text-base font-semibold" role="alert" style={{ background: "#FEF2F2", color: "#991B1B" }}>
          {CLAIM_STATUS_COPY.error.message}
        </p>
      ) : null}

      <button
        type="button"
        onClick={claim}
        disabled={!canClaim}
        className="kb-btn-primary mt-4 w-full py-4 text-xl"
      >
        {busy ? "Claiming your shop…" : CLAIM_BUTTON}
      </button>
    </Frame>
  );
}

export function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="kb-page min-h-page">
      <div className="mx-auto w-full max-w-md px-5 pb-16 pt-6">
        <div className="mb-6 flex justify-center">
          <Logo size={44} />
        </div>
        {children}
      </div>
    </main>
  );
}

export function Message({ title, message }: { title: string; message: string }) {
  return (
    <div className="kb-card-pop p-6 text-center" role="status">
      <h1 className="font-display text-2xl font-bold leading-tight" style={{ color: "var(--kb-ink)" }}>{title}</h1>
      <p className="mt-3 text-lg leading-8" style={{ color: "var(--kb-ink-soft)" }}>{message}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex gap-3">
      <span className="w-24 shrink-0 text-base" style={{ color: "var(--kb-ink-soft)" }}>{label}</span>
      <span className="min-w-0 flex-1 break-words font-semibold" style={{ color: "var(--kb-ink)" }}>{value}</span>
    </p>
  );
}

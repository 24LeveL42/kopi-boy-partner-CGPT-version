"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type BackHandler = () => void;

const BackContext = createContext<{
  registerBack: (handler: BackHandler | null) => void;
  registerCancel: (handler: BackHandler | null) => void;
} | null>(null);

function useBarHandler(kind: "back" | "cancel", handler: BackHandler | null) {
  const ctx = useContext(BackContext);
  // Callers pass a fresh closure each render; keep the latest in a ref and
  // only (un)register when the handler appears/disappears, so the bar isn't
  // re-rendered on every render of the calling screen.
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const active = handler !== null;
  useEffect(() => {
    if (!active) return;
    const register = kind === "back" ? ctx?.registerBack : ctx?.registerCancel;
    register?.(() => latest.current?.());
    return () => register?.(null);
  }, [ctx, active, kind]);
}

/**
 * Lets a screen with its own internal steps (e.g. the login flow, or the
 * apply form's role picker) take over the global Back button while it's
 * mounted, so Back steps within the screen instead of leaving it. Pass
 * `null` when there's no internal step to go back to.
 */
export function useBackHandler(handler: BackHandler | null) {
  useBarHandler("back", handler);
}

/**
 * Lets a screen holding unsaved work take over the global Cancel and Home
 * buttons while it's mounted (e.g. to ask "discard changes?" first), instead
 * of the bar silently resetting or leaving the screen. Pass `null` to hand
 * them back.
 */
export function useCancelHandler(handler: BackHandler | null) {
  useBarHandler("cancel", handler);
}

/**
 * The single, app-wide Back / Cancel / Home bar. Mounted once in the root
 * layout, so every route (and every screen `/` can render) gets it — pages
 * never add their own. Fixed to the top; content is offset by --app-bar-h
 * (see globals.css, `min-h-page`).
 *
 * - Back: one step back — a screen's own step (via useBackHandler), else the
 *   previous in-app page, else Home.
 * - Cancel: abandon what you're doing and discard unsaved input — leaves the
 *   page for Home, or, when already on Home, resets the screen to its start.
 * - Home: go to Home (on Home it also resets the screen's steps).
 * - A screen holding unsaved work can take over Cancel and Home via
 *   useCancelHandler, so neither silently wipes it.
 */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [override, setOverride] = useState<BackHandler | null>(null);
  const [cancelOverride, setCancelOverride] = useState<BackHandler | null>(null);
  // Bumped when Home is pressed while already on "/", to remount the page and
  // reset any in-page steps (login step, apply role picker) to the start.
  const [homeKey, setHomeKey] = useState(0);
  // True once this tab has navigated inside the app, so router.back() is
  // known to stay in-app (history.length also counts pages before the app,
  // e.g. the Google sign-in redirect). State (not a ref) because it drives
  // whether Back is disabled; set during render, which React allows for
  // state derived from props/hooks.
  const [firstPath] = useState(pathname);
  const [hasInAppHistory, setHasInAppHistory] = useState(false);
  if (!hasInAppHistory && pathname !== firstPath) setHasInAppHistory(true);

  const registerBack = useCallback((handler: BackHandler | null) => {
    setOverride(() => handler);
  }, []);
  const registerCancel = useCallback((handler: BackHandler | null) => {
    setCancelOverride(() => handler);
  }, []);
  const ctx = useMemo(() => ({ registerBack, registerCancel }), [registerBack, registerCancel]);

  const onHome = pathname === "/";
  // Only the very first screen of a visit has nowhere to go back to: on Home
  // with no step to unwind and no in-app page behind it.
  const backDisabled = onHome && !override && !hasInAppHistory;

  function handleBack() {
    if (override) {
      override();
    } else if (hasInAppHistory) {
      router.back();
    } else {
      router.push("/");
    }
  }

  // Remounting the page subtree resets any in-page state (login step, apply
  // role picker, half-filled forms) to its initial value.
  function resetScreen() {
    setHomeKey((k) => k + 1);
  }

  function handleCancel() {
    if (cancelOverride) {
      cancelOverride(); // the screen holds unsaved work and decides (e.g. confirm first)
    } else if (onHome) {
      resetScreen();
      router.refresh(); // also re-fetch server data, so nothing stale survives the cancel
    } else {
      router.push("/"); // leaving unmounts the page, discarding its unsaved input
    }
  }

  return (
    <BackContext.Provider value={ctx}>
      <header
        className="fixed inset-x-0 top-0 z-40 border-b"
        style={{ background: "var(--kb-navy)", borderColor: "var(--kb-navy-line)", height: "var(--app-bar-h)" }}
      >
        <nav
          aria-label="Page navigation"
          className="mx-auto grid h-full max-w-md grid-cols-3 items-center px-4 sm:max-w-lg sm:px-6"
        >
          <button
            type="button"
            onClick={handleBack}
            disabled={backDisabled}
            aria-label="Go back"
            className="flex items-center gap-1.5 justify-self-start rounded-full py-1.5 pl-2 pr-3 text-sm font-semibold disabled:opacity-35"
            style={{ color: "var(--kb-on-navy)" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 5 8 12 15 19" />
            </svg>
            Back
          </button>

          <button
            type="button"
            onClick={handleCancel}
            aria-label="Cancel and discard changes"
            className="flex items-center gap-1.5 justify-self-center rounded-full px-3 py-1.5 text-sm font-semibold"
            style={{ color: "var(--kb-on-navy)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
            Cancel
          </button>

          <Link
            href="/"
            onClick={(e) => {
              if (cancelOverride) {
                e.preventDefault();
                cancelOverride();
              } else if (onHome) {
                resetScreen();
              }
            }}
            aria-label="Go to home"
            aria-current={onHome ? "page" : undefined}
            className="flex items-center gap-1.5 justify-self-end rounded-full py-1.5 pl-3 pr-2 text-sm font-semibold"
            style={{ color: onHome ? "var(--kb-green)" : "var(--kb-on-navy)" }}
          >
            Home
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 11l8-7 8 7" />
              <path d="M6 10v10h4v-6h4v6h4V10" />
            </svg>
          </Link>
        </nav>
      </header>

      {/* Block (not flex) wrapper: pages centre themselves with mx-auto, which would shrink-wrap inside a flex column. */}
      <div key={homeKey} className="flex-1" style={{ paddingTop: "var(--app-bar-h)" }}>
        {children}
      </div>
    </BackContext.Provider>
  );
}

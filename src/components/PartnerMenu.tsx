"use client";

import { useState } from "react";
import Link from "next/link";
import { Logo } from "./Logo";
import { SignOutButton } from "./SignOutButton";
import { useNotifications } from "./NotificationsProvider";

/**
 * The hamburger button + slide-in drawer (Home, Notifications, My Profile,
 * Sign out). Shared by every signed-in screen that has a header, so Sign out
 * is always one tap away from the menu.
 */
export function PartnerMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { unreadCount } = useNotifications();

  return (
    <>
      <button
        type="button"
        aria-label="Open menu"
        onClick={() => setMenuOpen(true)}
        className="flex h-10 w-10 items-center justify-center rounded-xl border bg-white transition hover:shadow-md"
        style={{ color: "var(--kb-ink)", borderColor: "var(--kb-line)" }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </button>

      {menuOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-[#1E143C]/40 backdrop-blur-[2px]"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[80%] flex-col rounded-r-[28px] bg-white p-5 shadow-[0_20px_60px_rgba(30,20,60,0.18)]">
            <div className="flex items-center justify-between">
              <Logo size={30} />
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full"
                style={{ color: "var(--kb-ink-soft)", background: "var(--kb-tint)" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="5" y1="5" x2="19" y2="19" />
                  <line x1="19" y1="5" x2="5" y2="19" />
                </svg>
              </button>
            </div>

            <p className="kb-eyebrow mt-7 px-3">Menu</p>
            <nav className="mt-2 space-y-1">
              <Link
                href="/"
                onClick={() => setMenuOpen(false)}
                className="block rounded-xl px-3 py-3 text-sm font-semibold transition-colors hover:bg-[#F1EDFA]"
                style={{ color: "var(--kb-ink)" }}
              >
                Home
              </Link>
              <Link
                href="/notifications"
                onClick={() => setMenuOpen(false)}
                className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-semibold transition-colors hover:bg-[#F1EDFA]"
                style={{ color: "var(--kb-ink)" }}
              >
                Notifications
                {unreadCount > 0 && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
                    style={{ background: "var(--kb-danger)" }}
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>
              <Link
                href="/account"
                onClick={() => setMenuOpen(false)}
                className="block rounded-xl px-3 py-3 text-sm font-semibold transition-colors hover:bg-[#F1EDFA]"
                style={{ color: "var(--kb-ink)" }}
              >
                My Profile
              </Link>
            </nav>

            <div className="mt-auto border-t pt-4" style={{ borderColor: "var(--kb-line)" }}>
              <SignOutButton />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

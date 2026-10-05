"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md items-stretch justify-between rounded-t-3xl bg-white px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.15)] sm:max-w-lg"
      aria-label="Primary"
    >
      <Link
        href="/"
        className="flex flex-1 flex-col items-center gap-1 py-1.5"
        aria-current={pathname === "/" ? "page" : undefined}
        style={{ color: pathname === "/" ? "var(--kb-purple)" : "var(--kb-ink-soft)" }}
      >
        {pathname === "/" && <span className="h-0.5 w-6 rounded-full" style={{ background: "var(--kb-purple)" }} />}
        <OrdersIcon />
        <span className="text-[11px] font-medium">Home</span>
      </Link>

      <div className="flex flex-1 flex-col items-center gap-1 py-1.5 opacity-40" aria-disabled="true">
        <EarningsIcon />
        <span className="text-[11px] font-medium">Earnings (soon)</span>
      </div>

      <Link
        href="/account"
        className="flex flex-1 flex-col items-center gap-1 py-1.5"
        aria-current={pathname === "/account" ? "page" : undefined}
        style={{ color: pathname === "/account" ? "var(--kb-purple)" : "var(--kb-ink-soft)" }}
      >
        {pathname === "/account" && <span className="h-0.5 w-6 rounded-full" style={{ background: "var(--kb-purple)" }} />}
        <ProfileIcon />
        <span className="text-[11px] font-medium">Profile</span>
      </Link>
    </nav>
  );
}

function OrdersIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="4" width="14" height="16" rx="1.5" />
      <line x1="8" y1="9" x2="16" y2="9" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="12" y2="17" />
    </svg>
  );
}
function EarningsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M9.5 9.5h3.75a1.75 1.75 0 010 3.5h-2.5a1.75 1.75 0 000 3.5H14" />
    </svg>
  );
}
function ProfileIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20c1.7-4.2 4.9-6.5 7.5-6.5s5.8 2.3 7.5 6.5" />
    </svg>
  );
}

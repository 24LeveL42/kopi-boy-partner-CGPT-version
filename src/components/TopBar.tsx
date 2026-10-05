import Link from "next/link";
import { Logo } from "./Logo";
import { PartnerMenu } from "./PartnerMenu";
import { NotificationBell } from "./NotificationBell";

export function TopBar({ badge = "Partner" }: { badge?: string }) {
  return (
    <div className="flex items-center justify-between px-1 py-2">
      <PartnerMenu />

      <Logo size={30} />

      <div className="flex items-center gap-1.5">
        <NotificationBell />
        <Link
          href="/account"
          className="rounded-full px-3 py-1 text-xs font-semibold"
          style={{ background: "var(--kb-navy-raised)", color: "var(--kb-on-navy-soft)", border: "1px solid var(--kb-navy-line)" }}
        >
          {badge}
        </Link>
      </div>
    </div>
  );
}

import Link from "next/link";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { CookOrdersPanel } from "./CookOrdersPanel";
import { RiderDeliveriesPanel } from "./RiderDeliveriesPanel";
import { ProfileSummaryCard, type ProfileSummary } from "./ProfileSummaryCard";

/**
 * Partner app shell — real role detection now (Feature #002 is done).
 * Order-taking (#005/#006) is live for cooks, and the rider delivery
 * workflow (#008) is live below.
 */
export function PartnerShell({
  userId,
  defaultView,
  riderProfile,
}: {
  userId: string;
  defaultView: "cook" | "rider";
  /** Shown at the top of the rider view; the editor itself lives at /account. */
  riderProfile?: ProfileSummary;
}) {
  return (
    <div className="min-h-page pb-24" style={{ background: "var(--kb-navy)" }}>
      <div className="mx-auto max-w-md px-4 pt-4 sm:max-w-lg sm:px-6">
        <TopBar />
      </div>

      <main className="mx-auto max-w-md space-y-3 px-4 py-6 sm:max-w-lg sm:px-6">
        {defaultView === "cook" ? (
          <>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold" style={{ color: "var(--kb-on-navy)" }}>
                Orders
              </h2>
              <Link href="/kitchen" className="text-sm font-semibold" style={{ color: "var(--kb-green)" }}>
                Manage kitchen &amp; menu &rsaquo;
              </Link>
            </div>
            <CookOrdersPanel kitchenId={userId} />
          </>
        ) : (
          <>
            {riderProfile && <ProfileSummaryCard profile={riderProfile} />}
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold" style={{ color: "var(--kb-on-navy)" }}>
                Deliveries
              </h2>
              <Link href="/request-picker" className="text-sm font-semibold" style={{ color: "var(--kb-green)" }}>
                Request a picker &rsaquo;
              </Link>
            </div>
            <RiderDeliveriesPanel riderId={userId} />
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}

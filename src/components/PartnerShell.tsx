import Link from "next/link";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { CookOrdersPanel } from "./CookOrdersPanel";
import { RiderDeliveriesPanel } from "./RiderDeliveriesPanel";
import { ProfileSummaryCard, type ProfileSummary } from "./ProfileSummaryCard";

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export function PartnerShell({
  userId,
  defaultView,
  riderProfile,
  partnerName,
  businessName,
}: {
  userId: string;
  defaultView: "cook" | "rider";
  riderProfile?: ProfileSummary;
  partnerName?: string | null;
  businessName?: string | null;
}) {
  const isCook = defaultView === "cook";

  return (
    <div className="partner-dashboard min-h-page pb-28">
      <header className="mx-auto max-w-6xl px-4 pt-3 sm:px-6 lg:px-8">
        <TopBar />
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 pb-8 pt-4 sm:px-6 lg:px-8">
        <section className="partner-surface relative overflow-hidden rounded-[28px] p-5 sm:p-7">
          <div className="pointer-events-none absolute -right-12 -top-20 h-56 w-56 rounded-full opacity-70" style={{ background: "radial-gradient(circle, rgba(123,63,228,.14), transparent 70%)" }} />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: "var(--kb-purple)" }}>
                {isCook ? "Kopi Boy · Kitchen partner" : "Kopi Boy · Delivery partner"}
              </p>
              <h1 className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: "var(--kb-ink)" }}>
                {greeting()}{partnerName ? `, ${partnerName.split(" ")[0]}` : ""}
              </h1>
              <p className="mt-1 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
                {isCook ? businessName || "Your kitchen is ready for today" : "Your next delivery is just around the corner"}
              </p>
            </div>
            {isCook ? (
              <Link href="/kitchen" className="partner-primary inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-sm font-bold">
                <KitchenIcon /> Manage kitchen &amp; menu
              </Link>
            ) : riderProfile ? (
              <div className="w-full sm:w-auto sm:min-w-64">
                <ProfileSummaryCard profile={riderProfile} />
              </div>
            ) : null}
          </div>
        </section>

        {isCook ? (
          <>
            <section className="partner-surface rounded-[28px] p-4 sm:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div><p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: "var(--kb-purple)" }}>Live operations</p><h2 className="mt-1 font-display text-xl font-bold" style={{ color: "var(--kb-ink)" }}>Orders</h2></div>
                <span className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ color: "var(--kb-green-deep)", background: "#E5F7EF" }}>Live updates</span>
              </div>
              <CookOrdersPanel kitchenId={userId} />
            </section>
          </>
        ) : (
          <section className="partner-surface rounded-[28px] p-4 sm:p-6">
            <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div><p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: "var(--kb-purple)" }}>On the road</p><h2 className="mt-1 font-display text-xl font-bold" style={{ color: "var(--kb-ink)" }}>Delivery dashboard</h2></div>
              <Link href="/request-picker" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition hover:-translate-y-0.5" style={{ color: "var(--kb-purple)", background: "#F1EDFA" }}>
                Request a picker <span aria-hidden="true">›</span>
              </Link>
            </div>
            <RiderDeliveriesPanel riderId={userId} />
          </section>
        )}
      </main>
      <BottomNav />
    </div>
  );
}

function KitchenIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10h18M5 10v10h14V10M8 10V5h8v5M9 15h6" /></svg>;
}

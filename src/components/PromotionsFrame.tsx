import { Logo } from "./Logo";
import { PartnerMenu } from "./PartnerMenu";

/** The header + title block shared by the Promotions & Deals pages, matching Kitchen Setup. */
export function PromotionsFrame({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <div className="kb-page min-h-page">
      <div className="relative mx-auto max-w-md px-5 py-6">
        <div className="mb-6 flex items-center justify-between">
          <PartnerMenu isCook />
          <Logo size={36} />
          <span className="w-10" aria-hidden="true" /> {/* balances the menu button so the logo stays centred */}
        </div>
        <div className="text-center">
          <span className="kb-pill mb-2">Promotions &amp; Deals</span>
        </div>
        <h1 className="text-center font-display text-2xl font-bold tracking-tight" style={{ color: "var(--kb-ink)" }}>
          {title}
        </h1>
        <p className="mt-1.5 text-center text-sm leading-6" style={{ color: "var(--kb-ink-soft)" }}>
          {intro}
        </p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

/** A short notice card (deals switched off, kitchen banned, deal read-only). */
export function PromotionsNotice({ tone = "info", children }: { tone?: "info" | "warning" | "danger"; children: React.ReactNode }) {
  const style =
    tone === "danger"
      ? { background: "#FEF0F0", color: "#B42318" }
      : tone === "warning"
        ? { background: "rgba(245,158,11,0.10)", color: "#92400E" }
        : { background: "var(--kb-tint)", color: "var(--kb-purple)" };
  return (
    <p className="rounded-2xl px-4 py-3 text-sm" style={style}>
      {children}
    </p>
  );
}

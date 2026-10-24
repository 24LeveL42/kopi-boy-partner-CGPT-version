"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePendingAction } from "@/lib/use-pending-action";
import { PendingLabel } from "./Pending";
import {
  STATUS_LABEL,
  canDelete,
  canEdit,
  canStop,
  canSwitchOn,
  describePromotionError,
  draftFromPromotion,
  groupPromotions,
  kindLabel,
  limitLabel,
  previewDeal,
  promotionStatus,
  timeLabel,
  type DealMenuItem,
  type PromotionGroup,
  type PromotionStatus,
  type PromotionWithUsage,
} from "@/lib/promotions";

const GROUPS: { id: PromotionGroup; title: string; empty: string }[] = [
  { id: "running", title: "Running", empty: "No deals running right now." },
  { id: "upcoming", title: "Upcoming", empty: "Nothing scheduled." },
  { id: "ended", title: "Ended", empty: "No past deals yet." },
];

export function statusChipStyle(status: PromotionStatus): React.CSSProperties {
  switch (status) {
    case "running":
      return { background: "#E5F7EF", color: "var(--kb-green-deep)" };
    case "upcoming":
      return { background: "var(--kb-tint)", color: "var(--kb-purple)" };
    case "disabled":
      return { background: "#FEF0F0", color: "#B42318" };
    default:
      return { background: "var(--kb-field)", color: "var(--kb-ink-soft)" };
  }
}

type Confirm = { action: "stop" | "delete"; promotion: PromotionWithUsage };

export function PromotionsList({
  userId,
  promotions,
  menu,
  serverNow,
  canCreate,
}: {
  userId: string;
  promotions: PromotionWithUsage[];
  menu: DealMenuItem[];
  serverNow: number;
  canCreate: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const { busy, isRunning, run, startTransition } = usePendingAction();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // Starts at the server's clock so the first render matches, then ticks.
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  const groups = groupPromotions(promotions, now);

  function setActive(p: PromotionWithUsage, isActive: boolean) {
    setError(null);
    run(`${p.id}:${isActive ? "on" : "stop"}`, async () => {
      const { data, error: updateError } = await supabase
        .from("promotions")
        .update({ is_active: isActive })
        .eq("id", p.id)
        .eq("kitchen_id", userId)
        .select("id");
      if (updateError) {
        setError(describePromotionError(updateError));
        return;
      }
      if (!data || data.length === 0) {
        setError("That deal couldn't be changed. Reload the page and try again.");
        return;
      }
      startTransition(() => router.refresh());
    });
  }

  function remove(p: PromotionWithUsage) {
    setError(null);
    run(`${p.id}:delete`, async () => {
      const { data, error: deleteError } = await supabase.from("promotions").delete().eq("id", p.id).eq("kitchen_id", userId).select("id");
      if (deleteError) {
        setError(describePromotionError(deleteError));
        return;
      }
      if (!data || data.length === 0) {
        setError("That deal couldn't be deleted. Reload the page and try again.");
        return;
      }
      startTransition(() => router.refresh());
    });
  }

  function onConfirm() {
    if (!confirm) return;
    const { action, promotion } = confirm;
    setConfirm(null);
    if (action === "stop") setActive(promotion, false);
    else remove(promotion);
  }

  return (
    <div className="space-y-5">
      {canCreate && (
        <Link href="/promotions/new" className="kb-btn-primary flex w-full items-center justify-center py-3.5 text-[15px]">
          + New deal
        </Link>
      )}

      {error && <p className="kb-alert-error rounded-2xl px-4 py-3 text-sm">{error}</p>}

      {GROUPS.map((group) => (
        <section key={group.id}>
          <h2 className="px-1 text-xs font-bold uppercase tracking-[0.12em]" style={{ color: "var(--kb-ink-soft)" }}>
            {group.title} {groups[group.id].length > 0 && `· ${groups[group.id].length}`}
          </h2>
          {groups[group.id].length === 0 ? (
            <p className="kb-card mt-2 p-4 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
              {group.empty}
            </p>
          ) : (
            <div className="mt-2 space-y-3">
              {groups[group.id].map((p) => (
                <PromotionCard
                  key={p.id}
                  promotion={p}
                  menu={menu}
                  now={now}
                  busy={busy}
                  isRunning={isRunning}
                  onStop={() => setConfirm({ action: "stop", promotion: p })}
                  onSwitchOn={() => setActive(p, true)}
                  onDelete={() => setConfirm({ action: "delete", promotion: p })}
                />
              ))}
            </div>
          )}
        </section>
      ))}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" role="alertdialog" aria-modal="true" aria-labelledby="deal-confirm-title">
          <button type="button" aria-label="Cancel" onClick={() => setConfirm(null)} className="absolute inset-0 bg-[#1E143C]/40 backdrop-blur-[2px]" />
          <div className="kb-card-pop relative w-full max-w-sm p-6">
            <h2 id="deal-confirm-title" className="font-display text-xl font-bold">
              {confirm.action === "stop" ? "Stop this deal now?" : "Delete this deal?"}
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
              {confirm.action === "stop"
                ? `"${confirm.promotion.title}" stops straight away. Orders already placed keep their discount. You can switch it on again before its end time.`
                : `"${confirm.promotion.title}" will be removed for good.`}
            </p>
            <div className="mt-4 space-y-2">
              <button type="button" autoFocus onClick={() => setConfirm(null)} className="kb-btn-primary w-full py-3 text-sm">
                Keep it
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="kb-btn-ghost w-full py-3 text-sm"
                style={{ color: "var(--kb-danger)" }}
              >
                {confirm.action === "stop" ? "Stop now" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PromotionCard({
  promotion: p,
  menu,
  now,
  busy,
  isRunning,
  onStop,
  onSwitchOn,
  onDelete,
}: {
  promotion: PromotionWithUsage;
  menu: DealMenuItem[];
  now: number;
  busy: boolean;
  isRunning: (key: string) => boolean;
  onStop: () => void;
  onSwitchOn: () => void;
  onDelete: () => void;
}) {
  const status = promotionStatus(p, now);
  const offer = previewDeal(draftFromPromotion(p, p.item_ids), menu, p.quantity_claimed);
  const names = new Map(menu.map((m) => [m.id, m.name]));
  const items =
    p.kind === "free_item"
      ? null
      : p.item_ids.length === 0
        ? "Whole menu"
        : p.item_ids.map((id) => names.get(id) ?? "Removed item").join(", ");
  const limit = limitLabel(p);

  return (
    <article className="kb-card p-4" style={{ color: "var(--kb-ink)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: "var(--kb-purple)" }}>{kindLabel(p.kind)}</p>
          <h3 className="mt-0.5 break-words font-display text-lg font-bold leading-tight">{p.title}</h3>
        </div>
        <span className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold" style={statusChipStyle(status)}>
          {STATUS_LABEL[status]}
        </span>
      </div>
      {offer && <p className="mt-1.5 text-sm font-semibold">{offer.label}</p>}
      {items && <p className="mt-0.5 text-xs" style={{ color: "var(--kb-ink-soft)" }}>Items: {items}</p>}
      <p className="mt-2 text-xs" style={{ color: "var(--kb-ink-soft)" }}>{timeLabel(p, now)}</p>
      <p className="mt-0.5 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
        {[limit, `${p.order_count} ${p.order_count === 1 ? "order" : "orders"} used it`].filter(Boolean).join(" · ")}
      </p>
      {status === "disabled" && (
        <p className="mt-2 rounded-xl px-3 py-2 text-xs" style={{ background: "#FEF0F0", color: "#B42318" }}>
          Kopi Boy HQ turned this deal off{p.disabled_reason ? `: ${p.disabled_reason}` : "."}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {canEdit(p) && (
          <Link href={`/promotions/${p.id}`} className="kb-btn-secondary px-4 py-2 text-sm" aria-disabled={busy}>
            Edit
          </Link>
        )}
        {canStop(p, now) && (
          <button type="button" onClick={onStop} disabled={busy} className="kb-btn-ghost px-4 py-2 text-sm" style={{ color: "var(--kb-danger)" }}>
            <PendingLabel pending={isRunning(`${p.id}:stop`)} pendingText="Stopping…">Stop now</PendingLabel>
          </button>
        )}
        {canSwitchOn(p, now) && (
          <button type="button" onClick={onSwitchOn} disabled={busy} className="kb-btn-secondary px-4 py-2 text-sm">
            <PendingLabel pending={isRunning(`${p.id}:on`)} pendingText="Switching on…">Switch on again</PendingLabel>
          </button>
        )}
        {canDelete(p, p.order_count) && (
          <button type="button" onClick={onDelete} disabled={busy} className="kb-btn-ghost px-4 py-2 text-sm" style={{ color: "var(--kb-danger)" }}>
            <PendingLabel pending={isRunning(`${p.id}:delete`)} pendingText="Deleting…">Delete</PendingLabel>
          </button>
        )}
      </div>
    </article>
  );
}

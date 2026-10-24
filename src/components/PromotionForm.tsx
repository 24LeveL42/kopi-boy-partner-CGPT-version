"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePendingAction } from "@/lib/use-pending-action";
import { PendingLabel } from "./Pending";
import { FormField } from "./FormField";
import { useBackHandler, useCancelHandler } from "./AppChrome";
import {
  BUY_GET_MAX,
  DESCRIPTION_MAX,
  PROMOTION_KINDS,
  QUICK_ENDS,
  TERMS_MAX,
  TITLE_MAX,
  countsPortions,
  describePromotionError,
  draftFromPromotion,
  editLocks,
  emptyDraft,
  formatDuration,
  formatSgt,
  fromSgtInput,
  kindInfo,
  previewDeal,
  promotionWarnings,
  quickEndAt,
  toSgtInput,
  validatePromotion,
  type DealMenuItem,
  type DealSettings,
  type DiscountType,
  type DraftField,
  type PromotionDraft,
  type PromotionKind,
  type PromotionWithUsage,
  type QuickEnd,
} from "@/lib/promotions";

const DISCOUNT_LABEL: Record<DiscountType, string> = { percent: "Percent off", amount: "Amount off", price: "Deal price" };

const money = (n: number) => `$${n.toFixed(2)}`;

export function PromotionForm({
  menu,
  settings,
  existing,
  serverNow,
}: {
  menu: DealMenuItem[];
  settings: DealSettings;
  existing?: PromotionWithUsage;
  serverNow: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = !!existing;
  const [draft, setDraft] = useState<PromotionDraft>(() =>
    existing ? draftFromPromotion(existing, existing.item_ids) : emptyDraft(serverNow)
  );
  // Starts at the server's clock so the first render matches, then ticks.
  const [now, setNow] = useState(serverNow);
  const [touched, setTouched] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const { busy, isRunning, run, startTransition } = usePendingAction();

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  const locks = editLocks(existing, now);
  const info = kindInfo(draft.kind);
  const discountType: DiscountType | null = info.discountTypes.length === 0
    ? null
    : info.discountTypes.includes(draft.discountType) ? draft.discountType : info.discountTypes[0];
  const result = validatePromotion(draft, { now, settings, menu, existing });
  const errors = showErrors ? result.errors : {};
  const warnings = result.value ? promotionWarnings(result.value, result.itemIds, menu) : [];
  const preview = previewDeal(draft, menu, existing?.quantity_claimed ?? 0);

  function leave() {
    router.push("/promotions");
  }
  function requestLeave() {
    if (busy) return;
    if (touched) setConfirmLeave(true);
    else leave();
  }
  useBackHandler(touched ? requestLeave : null);
  useCancelHandler(requestLeave);

  function set<K extends DraftField>(field: K, value: PromotionDraft[K]) {
    setTouched(true);
    setDraft((d) => ({ ...d, [field]: value }));
  }

  function pickKind(kind: PromotionKind) {
    const next = kindInfo(kind);
    setTouched(true);
    setDraft((d) => ({
      ...d,
      kind,
      discountType: next.discountTypes.includes(d.discountType) ? d.discountType : (next.discountTypes[0] ?? d.discountType),
    }));
  }

  function toggleItem(id: string) {
    setTouched(true);
    setDraft((d) => ({ ...d, itemIds: d.itemIds.includes(id) ? d.itemIds.filter((x) => x !== id) : [...d.itemIds, id] }));
  }

  function pickQuickEnd(e: React.MouseEvent<HTMLButtonElement>) {
    const choice = e.currentTarget.value as QuickEnd;
    const current = Date.now();
    const start = locks.start && existing
      ? Date.parse(existing.starts_at)
      : draft.startMode === "now" ? current : (fromSgtInput(draft.startAt) ?? current);
    // A deal already running counts from now: "1 hour" means one more hour.
    set("endAt", toSgtInput(quickEndAt(choice, Math.max(start, current))));
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setShowErrors(true);
    setError(null);
    const checked = validatePromotion(draft, { now: Date.now(), settings, menu, existing });
    const value = checked.value;
    if (!value) {
      setError("Please fix the highlighted fields.");
      return;
    }
    run("save", async () => {
      // One call so the deal and its items are saved together (a deal saved
      // without its items would briefly apply to the whole menu).
      const { error: saveError } = await supabase.rpc("save_my_promotion", { p: value, item_ids: checked.itemIds });
      if (saveError) {
        console.error("PromotionForm: save failed", saveError);
        setError(describePromotionError(saveError));
        return;
      }
      startTransition(() => {
        router.push("/promotions");
        router.refresh();
      });
    });
  }

  const startMs = locks.start && existing
    ? Date.parse(existing.starts_at)
    : draft.startMode === "now" ? now : fromSgtInput(draft.startAt);
  const endMs = fromSgtInput(draft.endAt);
  const runsFor = startMs != null && endMs != null && endMs > startMs ? formatDuration(endMs - startMs) : null;
  const limitIsPortions = countsPortions(draft.kind);

  return (
    <form onSubmit={handleSave} className="space-y-5" noValidate>
      {locks.offer && (
        <p className="rounded-2xl px-4 py-3 text-sm" style={{ background: "var(--kb-tint)", color: "var(--kb-purple)" }}>
          🔒 Customers have ordered with this deal, so its offer, items, limits and start are locked. You can still change the title,
          description, terms and end time, or stop it. To change the offer, stop this deal and create a new one.
        </p>
      )}
      {!settings.dealsEnabled && (
        <p className="rounded-2xl px-4 py-3 text-sm" style={{ background: "rgba(245,158,11,0.10)", color: "#92400E" }}>
          Deals are switched off by Kopi Boy at the moment. You can set this one up now; customers will see it once deals are switched on.
        </p>
      )}

      <section className="kb-card space-y-4 p-5">
        <div>
          <p className="kb-eyebrow">Step 1</p>
          <h2 className="mt-1 font-display text-xl font-bold">Type of deal</h2>
        </div>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Type of deal">
          {PROMOTION_KINDS.map((k) => {
            const selected = draft.kind === k.kind;
            return (
              <button
                key={k.kind}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={locks.offer}
                onClick={() => pickKind(k.kind)}
                className="rounded-2xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60"
                style={selected
                  ? { borderColor: "var(--kb-purple)", background: "var(--kb-tint)", color: "var(--kb-ink)" }
                  : { borderColor: "var(--kb-line)", background: "#fff", color: "var(--kb-ink)" }}
              >
                <span className="block text-sm font-bold">{k.label}</span>
                <span className="block text-[11px] leading-4" style={{ color: "var(--kb-ink-soft)" }}>{k.hint}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="kb-card space-y-4 p-5">
        <div>
          <p className="kb-eyebrow">Step 2</p>
          <h2 className="mt-1 font-display text-xl font-bold">What customers read</h2>
        </div>
        <FormField label={<Counted label="Title" value={draft.title} max={TITLE_MAX} />}>
          <input value={draft.title} onChange={(e) => set("title", e.target.value)} maxLength={TITLE_MAX} placeholder="e.g. Lunch special" className="kb-input" />
          <FieldError message={errors.title} />
        </FormField>
        <FormField label={<Counted label="Short description (optional)" value={draft.description} max={DESCRIPTION_MAX} />}>
          <textarea value={draft.description} onChange={(e) => set("description", e.target.value)} maxLength={DESCRIPTION_MAX} rows={2} className="kb-input" />
          <FieldError message={errors.description} />
        </FormField>
        <FormField label={<Counted label="Terms (optional)" value={draft.terms} max={TERMS_MAX} />}>
          <textarea value={draft.terms} onChange={(e) => set("terms", e.target.value)} maxLength={TERMS_MAX} rows={3} placeholder="e.g. Not valid with other offers." className="kb-input" />
          <FieldError message={errors.terms} />
        </FormField>
      </section>

      <section className="kb-card space-y-4 p-5">
        <div>
          <p className="kb-eyebrow">Step 3</p>
          <h2 className="mt-1 font-display text-xl font-bold">The offer</h2>
        </div>
        <fieldset disabled={locks.offer} className="space-y-4 disabled:opacity-70">
          {discountType && info.discountTypes.length > 1 && (
            <div className="flex gap-2" role="radiogroup" aria-label="How the discount works">
              {info.discountTypes.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={discountType === t}
                  onClick={() => set("discountType", t)}
                  className="flex-1 rounded-xl border px-2 py-2 text-xs font-bold"
                  style={discountType === t
                    ? { borderColor: "var(--kb-purple)", background: "var(--kb-tint)", color: "var(--kb-purple)" }
                    : { borderColor: "var(--kb-line)", background: "#fff", color: "var(--kb-ink-soft)" }}
                >
                  {DISCOUNT_LABEL[t]}
                </button>
              ))}
            </div>
          )}

          {(draft.kind === "percent_off" || discountType === "percent") && (
            <FormField label={`Percent off (max ${Math.min(100, settings.maxPercentOff)}%)`}>
              <input value={draft.percentOff} onChange={(e) => set("percentOff", e.target.value)} inputMode="decimal" placeholder="e.g. 20" className="kb-input" />
              <FieldError message={errors.percentOff} />
            </FormField>
          )}
          {(draft.kind === "amount_off" || discountType === "amount") && (
            <FormField label={limitIsPortions ? "Amount off each portion ($)" : "Amount off ($)"}>
              <input value={draft.amountOff} onChange={(e) => set("amountOff", e.target.value)} inputMode="decimal" placeholder="e.g. 2.00" className="kb-input" />
              <FieldError message={errors.amountOff} />
            </FormField>
          )}
          {discountType === "price" && (
            <FormField label="Deal price per portion ($)">
              <input value={draft.dealPrice} onChange={(e) => set("dealPrice", e.target.value)} inputMode="decimal" placeholder="e.g. 4.50" className="kb-input" />
              <FieldError message={errors.dealPrice} />
            </FormField>
          )}
          {draft.kind === "buy_x_get_y" && (
            <div className="flex gap-2">
              <FormField label={`Buy (1–${BUY_GET_MAX})`} className="flex-1">
                <input value={draft.buyQty} onChange={(e) => set("buyQty", e.target.value)} inputMode="numeric" placeholder="2" className="kb-input" />
                <FieldError message={errors.buyQty} />
              </FormField>
              <FormField label={`Get free (1–${BUY_GET_MAX})`} className="flex-1">
                <input value={draft.getQty} onChange={(e) => set("getQty", e.target.value)} inputMode="numeric" placeholder="1" className="kb-input" />
                <FieldError message={errors.getQty} />
              </FormField>
            </div>
          )}
          {draft.kind === "buy_x_get_y" && (
            <p className="-mt-2 text-xs" style={{ color: "var(--kb-ink-soft)" }}>The cheapest chosen items in the cart are the free ones.</p>
          )}
          {draft.kind === "free_item" && (
            <FormField label="Free item">
              <select value={draft.freeItemId} onChange={(e) => set("freeItemId", e.target.value)} className="kb-input">
                <option value="">Choose a dish…</option>
                {menu.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({money(Number(m.price))})
                  </option>
                ))}
              </select>
              <FieldError message={errors.freeItemId} />
              <span className="mt-1 block font-normal" style={{ color: "var(--kb-ink-soft)" }}>One is free when the customer adds it to the cart.</span>
            </FormField>
          )}
          {(draft.kind === "min_spend" || draft.kind === "percent_off" || draft.kind === "amount_off" || draft.kind === "free_item") && (
            <FormField label={draft.kind === "min_spend" ? "Minimum spend ($)" : "Minimum spend ($, optional)"}>
              <input value={draft.minSpend} onChange={(e) => set("minSpend", e.target.value)} inputMode="decimal" placeholder="e.g. 20.00" className="kb-input" />
              <FieldError message={errors.minSpend} />
            </FormField>
          )}

          {info.usesItems && (
            <div>
              <p className="text-xs font-semibold" style={{ color: "var(--kb-ink-soft)" }}>Which items</p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                {draft.itemIds.length === 0 ? "None ticked: the deal covers your whole menu." : `${draft.itemIds.length} ticked.`}
              </p>
              <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-2xl border p-2" style={{ borderColor: "var(--kb-line)" }}>
                {menu.length === 0 && <p className="p-2 text-sm" style={{ color: "var(--kb-ink-soft)" }}>Your menu is empty.</p>}
                {menu.map((m) => (
                  <label key={m.id} className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm hover:bg-[#F1EDFA]">
                    <input type="checkbox" checked={draft.itemIds.includes(m.id)} onChange={() => toggleItem(m.id)} className="h-4 w-4 shrink-0 accent-[#7B3FE4]" />
                    <span className="min-w-0 flex-1 truncate" style={{ color: "var(--kb-ink)" }}>{m.name}</span>
                    <span className="shrink-0 text-xs" style={{ color: "var(--kb-ink-soft)" }}>{money(Number(m.price))}</span>
                  </label>
                ))}
              </div>
              <FieldError message={errors.itemIds} />
            </div>
          )}

          <div className="flex gap-2">
            <FormField
              label={draft.kind === "limited_qty" ? "Portions on offer" : limitIsPortions ? "Portion limit (recommended)" : "Total redemptions (optional)"}
              className="flex-1"
            >
              <input value={draft.quantityLimit} onChange={(e) => set("quantityLimit", e.target.value)} inputMode="numeric" placeholder={limitIsPortions ? "e.g. 30" : "No limit"} className="kb-input" />
              <FieldError message={errors.quantityLimit} />
            </FormField>
            <FormField label="Per customer (optional)" className="flex-1">
              <input value={draft.perCustomerLimit} onChange={(e) => set("perCustomerLimit", e.target.value)} inputMode="numeric" placeholder="No limit" className="kb-input" />
              <FieldError message={errors.perCustomerLimit} />
            </FormField>
          </div>
          <p className="-mt-2 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
            {limitIsPortions ? "Portions count dishes sold at the deal." : "Redemptions count orders that use the deal."} Per customer counts their orders.
          </p>
        </fieldset>
      </section>

      <section className="kb-card space-y-4 p-5">
        <div>
          <p className="kb-eyebrow">Step 4</p>
          <h2 className="mt-1 font-display text-xl font-bold">Timeline</h2>
          <p className="mt-0.5 text-xs" style={{ color: "var(--kb-ink-soft)" }}>All times are Singapore time.</p>
        </div>

        {locks.start && existing ? (
          <p className="text-sm" style={{ color: "var(--kb-ink)" }}>
            Started <span className="font-semibold">{formatSgt(existing.starts_at)}</span>
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2" role="radiogroup" aria-label="Start">
              {(["now", "schedule"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={draft.startMode === mode}
                  onClick={() => set("startMode", mode)}
                  className="flex-1 rounded-xl border px-2 py-2 text-xs font-bold"
                  style={draft.startMode === mode
                    ? { borderColor: "var(--kb-purple)", background: "var(--kb-tint)", color: "var(--kb-purple)" }
                    : { borderColor: "var(--kb-line)", background: "#fff", color: "var(--kb-ink-soft)" }}
                >
                  {mode === "now" ? "Start now" : "Schedule"}
                </button>
              ))}
            </div>
            {draft.startMode === "schedule" && (
              <FormField label="Starts">
                <input type="datetime-local" value={draft.startAt} min={toSgtInput(now)} onChange={(e) => set("startAt", e.target.value)} className="kb-input" />
                <FieldError message={errors.startAt} />
              </FormField>
            )}
          </div>
        )}

        <FormField label="Ends">
          <input type="datetime-local" value={draft.endAt} min={toSgtInput(now)} onChange={(e) => set("endAt", e.target.value)} className="kb-input" />
          <FieldError message={errors.endAt} />
        </FormField>
        <div className="flex flex-wrap gap-2">
          {QUICK_ENDS.map((q) => (
            <button key={q.id} type="button" value={q.id} onClick={pickQuickEnd} className="rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--kb-line)", color: "var(--kb-purple)", background: "#fff" }}>
              {q.label}
            </button>
          ))}
        </div>
        {runsFor && endMs != null && (
          <p className="text-xs" style={{ color: "var(--kb-ink-soft)" }}>
            Runs for {runsFor}, ending {formatSgt(endMs)}.
          </p>
        )}
      </section>

      <section className="kb-card-pop p-5">
        <p className="kb-eyebrow">Preview</p>
        <p className="mt-0.5 text-xs" style={{ color: "var(--kb-ink-soft)" }}>How customers will see it</p>
        {preview ? (
          <div className="mt-3 rounded-2xl p-4" style={{ background: "linear-gradient(135deg, #7B3FE4, #5B2BB8)", color: "#fff" }}>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] opacity-80">{info.label}</p>
            <p className="mt-1 font-display text-lg font-bold leading-tight">{preview.label}</p>
            {draft.title.trim() && <p className="mt-1 text-sm opacity-90">{draft.title.trim()}</p>}
            {draft.description.trim() && <p className="mt-1 text-xs opacity-80">{draft.description.trim()}</p>}
            {preview.example && (
              <p className="mt-2 text-sm">
                {preview.example.name}: <span className="line-through opacity-70">{money(preview.example.was)}</span>{" "}
                <span className="font-bold">{money(preview.example.now)}</span>
              </p>
            )}
            {preview.detail && <p className="mt-1 text-xs font-semibold opacity-90">{preview.detail}</p>}
            {endMs != null && endMs > now && <p className="mt-2 text-[11px] opacity-80">Ends {formatSgt(endMs)}</p>}
          </div>
        ) : (
          <p className="mt-3 text-sm" style={{ color: "var(--kb-ink-soft)" }}>Fill in the offer to see the preview.</p>
        )}
      </section>

      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-2xl px-4 py-3 text-sm" style={{ background: "rgba(245,158,11,0.10)", color: "#92400E" }}>
          {warnings.map((w) => (
            <li key={w}>⚠️ {w}</li>
          ))}
        </ul>
      )}
      {error && <p className="kb-alert-error rounded-2xl px-4 py-3 text-sm">{error}</p>}

      <button type="submit" disabled={busy} className="kb-btn-primary w-full py-3.5 text-[15px]">
        <PendingLabel pending={isRunning("save")} pendingText="Saving…">{isEdit ? "Save changes" : "Create deal"}</PendingLabel>
      </button>
      <button type="button" onClick={requestLeave} disabled={busy} className="kb-btn-ghost w-full py-3 text-[15px]">
        Cancel
      </button>

      {confirmLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" role="alertdialog" aria-modal="true" aria-labelledby="deal-leave-title">
          <button type="button" aria-label="Keep editing" onClick={() => setConfirmLeave(false)} className="absolute inset-0 bg-[#1E143C]/40 backdrop-blur-[2px]" />
          <div className="kb-card-pop relative w-full max-w-sm p-6">
            <h2 id="deal-leave-title" className="font-display text-xl font-bold">Discard this deal?</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--kb-ink-soft)" }}>Your unsaved changes will be lost.</p>
            <div className="mt-4 space-y-2">
              <button type="button" autoFocus onClick={() => setConfirmLeave(false)} className="kb-btn-primary w-full py-3 text-sm">
                Keep editing
              </button>
              <button type="button" onClick={leave} className="kb-btn-ghost w-full py-3 text-sm">
                Discard changes
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}

function Counted({ label, value, max }: { label: string; value: string; max: number }) {
  return (
    <span className="flex justify-between">
      <span>{label}</span>
      <span className="font-normal">{value.length}/{max}</span>
    </span>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <span className="mt-1 block text-xs font-normal" style={{ color: "var(--kb-danger)" }}>
      {message}
    </span>
  );
}

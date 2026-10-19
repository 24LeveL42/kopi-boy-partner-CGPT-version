"use client";

import { useState, type ReactNode } from "react";
import { PendingLabel } from "./Pending";
import { PAST_ORDERS_PAGE_SIZE, type HideResult } from "@/lib/past-orders";
import type { usePendingAction } from "@/lib/use-pending-action";

const REMOVE_ONE_PROMPT = "Remove this order from your list? It will stay in Kopi Boy's records.";

/**
 * "Past orders (N)": closed by default, opens like a dropdown, newest first
 * (the caller sorts), PAST_ORDERS_PAGE_SIZE at a time. Each card can be
 * removed from the viewer's list — hidden for them only, never deleted —
 * after a confirm step. Shares the parent's usePendingAction so nothing else
 * on the screen fires while a removal is in flight.
 */
export function PastOrdersSection<T>({
  items,
  getId,
  renderItem,
  removeOne,
  removeAll,
  onRemoved,
  pending,
}: {
  items: T[];
  getId: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  removeOne: (id: string) => Promise<HideResult>;
  removeAll: () => Promise<HideResult>;
  /** Reload the list after a successful removal. */
  onRemoved: () => Promise<void>;
  pending: Pick<ReturnType<typeof usePendingAction>, "busy" | "isRunning" | "run">;
}) {
  const { busy, isRunning, run } = pending;
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(PAST_ORDERS_PAGE_SIZE);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) return null;

  function remove(key: string, write: () => Promise<HideResult>, done: () => void) {
    run(key, async () => {
      setError(null);
      const result = await write();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      done();
      await onRemoved();
    });
  }

  const visible = items.slice(0, shown);

  return (
    <section className="rounded-2xl border border-[#eceaf1] bg-white" style={{ color: "var(--kb-ink)" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <span className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: "var(--kb-ink-soft)" }}>
          Past orders ({items.length})
        </span>
        <span aria-hidden="true" className="text-sm transition-transform" style={{ color: "var(--kb-purple)", transform: open ? "rotate(180deg)" : undefined }}>
          ▾
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-[#eceaf1] p-3">
          {error && (
            <p className="rounded-xl px-3 py-2 text-xs" style={{ background: "#FEF0F0", color: "#B42318" }}>
              {error}
            </p>
          )}

          {visible.map((item) => {
            const id = getId(item);
            return (
              <div key={id} className="rounded-2xl p-3" style={{ background: "#FAF9FC" }}>
                {renderItem(item)}
                {confirmingId === id ? (
                  <div className="mt-3 rounded-xl p-3" style={{ background: "var(--kb-cream)" }}>
                    <p className="text-xs font-semibold">{REMOVE_ONE_PROMPT}</p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => remove(`${id}:hide`, () => removeOne(id), () => setConfirmingId(null))}
                        disabled={busy}
                        className="flex-1 rounded-xl py-2 text-xs font-semibold text-white disabled:opacity-60"
                        style={{ background: "var(--kb-danger)" }}
                      >
                        <PendingLabel pending={isRunning(`${id}:hide`)} pendingText="Removing…">Remove</PendingLabel>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        disabled={busy}
                        className="flex-1 rounded-xl bg-white py-2 text-xs font-semibold disabled:opacity-60"
                        style={{ color: "var(--kb-ink-soft)" }}
                      >
                        Keep
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setConfirmingAll(false);
                      setConfirmingId(id);
                    }}
                    disabled={busy}
                    className="mt-2 text-xs font-semibold disabled:opacity-60"
                    style={{ color: "var(--kb-ink-soft)" }}
                  >
                    Remove from my list
                  </button>
                )}
              </div>
            );
          })}

          {items.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAST_ORDERS_PAGE_SIZE)}
              className="w-full rounded-xl py-2.5 text-xs font-bold"
              style={{ background: "#F1EDFA", color: "var(--kb-purple)" }}
            >
              Show more ({items.length - shown} left)
            </button>
          )}

          {confirmingAll ? (
            <div className="rounded-xl p-3" style={{ background: "var(--kb-cream)" }}>
              <p className="text-xs font-semibold">
                Remove all {items.length} past order{items.length === 1 ? "" : "s"} from your list? They will stay in Kopi Boy&apos;s records.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => remove("hide-all", removeAll, () => setConfirmingAll(false))}
                  disabled={busy}
                  className="flex-1 rounded-xl py-2 text-xs font-semibold text-white disabled:opacity-60"
                  style={{ background: "var(--kb-danger)" }}
                >
                  <PendingLabel pending={isRunning("hide-all")} pendingText="Removing…">Remove all</PendingLabel>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingAll(false)}
                  disabled={busy}
                  className="flex-1 rounded-xl bg-white py-2 text-xs font-semibold disabled:opacity-60"
                  style={{ color: "var(--kb-ink-soft)" }}
                >
                  Keep
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setConfirmingId(null);
                setConfirmingAll(true);
              }}
              disabled={busy}
              className="w-full rounded-xl py-2.5 text-xs font-semibold disabled:opacity-60"
              style={{ background: "#FEF0F0", color: "#B42318" }}
            >
              Remove all past orders
            </button>
          )}
        </div>
      )}
    </section>
  );
}

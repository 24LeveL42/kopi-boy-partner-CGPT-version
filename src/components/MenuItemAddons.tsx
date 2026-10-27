"use client";

import { useState } from "react";
import { Spinner } from "./Pending";
import { FormField as Field } from "./FormField";
import {
  MAX_GROUPS,
  MAX_NAME_LENGTH,
  MAX_OPTIONS,
  addonWarnings,
  emptyGroup,
  emptyOption,
  picksHint,
  type GroupDraft,
  type OptionDraft,
} from "@/lib/menu-addons";

/**
 * The "Add-ons" section under one dish in KitchenSetupForm: groups (name,
 * required, max picks) and their options (name, price, sold out). Edits are
 * part of the form and save with it; the sold-out switch on an option that's
 * already saved updates straight away (onQuickSoldOut), so a cook can mark
 * something sold out mid-service without touching the rest.
 */
export function MenuItemAddons({
  groups,
  onChange,
  errors,
  formError,
  onQuickSoldOut,
}: {
  groups: GroupDraft[];
  onChange: (groups: GroupDraft[]) => void;
  /** By group or option key, from checkAddons. */
  errors: Record<string, string>;
  formError?: string | null;
  /** Saves one saved option's sold_out now; resolves to an error message, or null. */
  onQuickSoldOut: (optionId: string, soldOut: boolean) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [toggleErrors, setToggleErrors] = useState<Record<string, string>>({});
  const warnings = addonWarnings(groups);
  const hasErrors = !!formError || groups.some((g) => errors[g.key] || g.options.some((o) => errors[o.key]));
  // A save with something to fix opens the section, so the cook sees what.
  const expanded = open || hasErrors;

  function updateGroup(key: string, patch: Partial<GroupDraft>) {
    onChange(groups.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  }

  function updateOption(groupKey: string, optionKey: string, patch: Partial<OptionDraft>) {
    onChange(
      groups.map((g) =>
        g.key === groupKey ? { ...g, options: g.options.map((o) => (o.key === optionKey ? { ...o, ...patch } : o)) } : g
      )
    );
  }

  async function toggleSoldOut(group: GroupDraft, option: OptionDraft) {
    const next = !option.sold_out;
    // Not saved yet: just part of the form.
    if (!option.id) {
      updateOption(group.key, option.key, { sold_out: next });
      return;
    }
    if (pending[option.key]) return;
    setPending((p) => ({ ...p, [option.key]: true }));
    setToggleErrors((e) => withoutKey(e, option.key));
    const message = await onQuickSoldOut(option.id, next);
    setPending((p) => withoutKey(p, option.key));
    if (message) setToggleErrors((e) => ({ ...e, [option.key]: message }));
  }

  const optionCount = groups.reduce((n, g) => n + g.options.length, 0);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        className="flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-sm font-semibold"
        style={{ background: "#F1EDFA", color: "var(--kb-purple)" }}
      >
        <span>
          Add-ons{groups.length > 0 ? ` (${groups.length} group${groups.length === 1 ? "" : "s"}, ${optionCount} option${optionCount === 1 ? "" : "s"})` : ""}
        </span>
        <span aria-hidden="true" className="transition-transform" style={{ transform: expanded ? "rotate(180deg)" : undefined }}>
          ▾
        </span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          <p className="text-xs leading-5" style={{ color: "var(--kb-ink-soft)" }}>
            Extras customers can tick, like spice level or an extra egg. Changes save with the button at the bottom; the
            Sold out switch on a saved option updates straight away.
          </p>

          {groups.map((g, gi) => (
            <div key={g.key} className="space-y-3 rounded-2xl border p-3" style={{ borderColor: "var(--kb-line)" }}>
              <Field label={`Group ${gi + 1} name`}>
                <input
                  value={g.name}
                  onChange={(e) => updateGroup(g.key, { name: e.target.value })}
                  placeholder="e.g. Spice level"
                  maxLength={MAX_NAME_LENGTH}
                  className="kb-input"
                />
              </Field>
              <div className="flex items-end gap-3">
                <Field label="Max picks" className="w-24 shrink-0">
                  <input
                    value={g.maxPicks}
                    onChange={(e) => updateGroup(g.key, { maxPicks: e.target.value })}
                    inputMode="numeric"
                    className="kb-input"
                  />
                </Field>
                <Toggle
                  label="Required"
                  checked={g.required}
                  onChange={() => updateGroup(g.key, { required: !g.required })}
                />
              </div>
              <p className="text-xs" style={{ color: "var(--kb-ink-soft)" }}>{picksHint(g.required, g.maxPicks)}</p>
              {errors[g.key] && <FieldMessage tone="error" text={errors[g.key]} />}
              {!errors[g.key] && warnings[g.key] && <FieldMessage tone="warning" text={warnings[g.key]} />}

              <div className="space-y-2">
                {g.options.map((o, oi) => (
                  <div key={o.key} className="space-y-1 rounded-xl p-2.5" style={{ background: "var(--kb-field)" }}>
                    <div className="flex items-end gap-2">
                      <Field label={`Option ${oi + 1}`} className="min-w-0 flex-[2]">
                        <input
                          value={o.name}
                          onChange={(e) => updateOption(g.key, o.key, { name: e.target.value })}
                          placeholder="e.g. Extra egg"
                          maxLength={MAX_NAME_LENGTH}
                          className="kb-input"
                          style={{ background: "white" }}
                        />
                      </Field>
                      <Field label="+ Price ($)" className="w-24 shrink-0">
                        <input
                          value={o.price}
                          onChange={(e) => updateOption(g.key, o.key, { price: e.target.value })}
                          inputMode="decimal"
                          placeholder="Free"
                          className="kb-input"
                          style={{ background: "white" }}
                        />
                      </Field>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Toggle
                          label="Sold out"
                          checked={o.sold_out}
                          disabled={!!pending[o.key]}
                          onChange={() => void toggleSoldOut(g, o)}
                        />
                        {pending[o.key] && <Spinner size={12} />}
                      </div>
                      <button
                        type="button"
                        onClick={() => updateGroup(g.key, { options: g.options.filter((x) => x.key !== o.key) })}
                        className="min-h-11 rounded-xl px-3 text-xs font-semibold"
                        style={{ color: "var(--kb-danger)" }}
                      >
                        Remove
                      </button>
                    </div>
                    {toggleErrors[o.key] && <FieldMessage tone="error" text={toggleErrors[o.key]} />}
                    {errors[o.key] && <FieldMessage tone="error" text={errors[o.key]} />}
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => updateGroup(g.key, { options: [...g.options, emptyOption()] })}
                  disabled={g.options.length >= MAX_OPTIONS}
                  className="kb-btn-secondary px-3 py-2 text-xs"
                >
                  + Add option
                </button>
                <button
                  type="button"
                  onClick={() => onChange(groups.filter((x) => x.key !== g.key))}
                  className="min-h-11 rounded-xl px-3 text-xs font-semibold"
                  style={{ color: "var(--kb-danger)", background: "rgba(239,68,68,0.06)" }}
                >
                  Remove group
                </button>
              </div>
            </div>
          ))}

          {formError && <FieldMessage tone="error" text={formError} />}
          <button
            type="button"
            onClick={() => onChange([...groups, emptyGroup()])}
            disabled={groups.length >= MAX_GROUPS}
            className="kb-btn-secondary w-full py-2.5 text-sm"
          >
            + Add add-on group
          </button>
        </div>
      )}
    </div>
  );
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className="flex min-h-11 items-center gap-2 text-sm font-semibold disabled:opacity-60"
      style={{ color: "var(--kb-ink)" }}
    >
      <span className="relative h-6 w-11 shrink-0 rounded-full transition-colors" style={{ background: checked ? "var(--kb-gradient)" : "#DCD8E5" }}>
        <span
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
          style={{ left: checked ? "1.375rem" : "0.125rem" }}
        />
      </span>
      {label}
    </button>
  );
}

function FieldMessage({ tone, text }: { tone: "error" | "warning"; text: string }) {
  return (
    <p className="text-xs font-medium" style={{ color: tone === "error" ? "var(--kb-danger)" : "#B54708" }}>
      {text}
    </p>
  );
}

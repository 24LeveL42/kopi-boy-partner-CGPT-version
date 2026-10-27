/**
 * Add-ons for a dish (menu_option_groups / menu_options): the menu editor's
 * drafts, their checks, and what is sent to public.save_menu_item_options
 * (docs/supabase-addons-partner.sql).
 *
 * Options are tick/untick (no quantity). A required group means the customer
 * picks at least 1 and at most max_picks; a sold-out option can't be picked.
 * Deals only ever reduce the dish price, never add-ons.
 *
 * Saving sends the whole list for one dish: groups and options with an id
 * are updated, ones without are inserted, and the dish's other groups and
 * options are deleted. So a payload must only ever be built from add-ons that
 * actually loaded — an empty list deletes them all.
 */

export const MAX_GROUPS = 20;
export const MAX_OPTIONS = 30;
export const MAX_PICKS = 20;
export const MAX_OPTION_PRICE = 999;
export const MAX_NAME_LENGTH = 60;

export interface SavedOption {
  id: string;
  name: string;
  price: number;
  sold_out: boolean;
}

export interface SavedGroup {
  id: string;
  name: string;
  required: boolean;
  max_picks: number;
  options: SavedOption[];
}

/** A dish's add-ons as the form edits them; `price` and `maxPicks` stay text while typing. */
export interface OptionDraft {
  key: string; // local React list key only — never sent to the DB
  id?: string;
  name: string;
  price: string;
  sold_out: boolean;
}

export interface GroupDraft {
  key: string;
  id?: string;
  name: string;
  required: boolean;
  maxPicks: string;
  options: OptionDraft[];
}

/** One group as sent to save_menu_item_options; array order is the sort order. */
export interface AddonGroupInput {
  id?: string;
  name: string;
  required: boolean;
  max_picks: number;
  options: { id?: string; name: string; price: number; sold_out: boolean }[];
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** A menu_option_groups row with its menu_options embedded, as the kitchen page selects it. */
export interface GroupRow {
  id: string;
  menu_item_id: string;
  name: string;
  required: boolean;
  max_picks: number;
  sort_order: number | null;
  menu_options: { id: string; name: string; price: number | string; sold_out: boolean; sort_order: number | null }[] | null;
}

const bySortOrder = (a: { sort_order: number | null }, b: { sort_order: number | null }) => (a.sort_order ?? 0) - (b.sort_order ?? 0);

/** Groups rows by dish, each list in sort order. */
export function addonsByItem(rows: GroupRow[]): Record<string, SavedGroup[]> {
  const out: Record<string, SavedGroup[]> = {};
  for (const row of [...rows].sort(bySortOrder)) {
    (out[row.menu_item_id] ??= []).push({
      id: row.id,
      name: row.name,
      required: row.required,
      max_picks: row.max_picks,
      options: [...(row.menu_options ?? [])]
        .sort(bySortOrder)
        .map((o) => ({ id: o.id, name: o.name, price: Number(o.price), sold_out: o.sold_out })),
    });
  }
  return out;
}

/** What save_menu_item_options returns: the dish's groups and options, in order. */
export function parseSavedGroups(data: unknown): SavedGroup[] {
  if (!Array.isArray(data)) return [];
  return data.map((g) => ({
    id: String(g.id),
    name: String(g.name),
    required: !!g.required,
    max_picks: Number(g.max_picks),
    options: (Array.isArray(g.options) ? g.options : []).map((o: SavedOption) => ({
      id: String(o.id),
      name: String(o.name),
      price: Number(o.price),
      sold_out: !!o.sold_out,
    })),
  }));
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export function emptyOption(): OptionDraft {
  return { key: crypto.randomUUID(), name: "", price: "", sold_out: false };
}

export function emptyGroup(): GroupDraft {
  return { key: crypto.randomUUID(), name: "", required: false, maxPicks: "1", options: [emptyOption()] };
}

export function draftsFromSaved(groups: SavedGroup[]): GroupDraft[] {
  return groups.map((g) => ({
    key: g.id,
    id: g.id,
    name: g.name,
    required: g.required,
    maxPicks: String(g.max_picks),
    options: g.options.map((o) => ({ key: o.id, id: o.id, name: o.name, price: String(o.price), sold_out: o.sold_out })),
  }));
}

/**
 * Puts the ids save_menu_item_options returned on the drafts they came from.
 * The payload's order is the saved order, so they line up by position; a row
 * whose name no longer matches (edited while saving) is left alone.
 */
export function draftsWithSavedIds(drafts: GroupDraft[], saved: SavedGroup[]): GroupDraft[] {
  return drafts.map((g, gi) => {
    const sg = saved[gi];
    if (!sg || sg.name !== g.name.trim()) return g;
    return {
      ...g,
      id: sg.id,
      options: g.options.map((o, oi) => {
        const so = sg.options[oi];
        return so && so.name === o.name.trim() ? { ...o, id: so.id } : o;
      }),
    };
  });
}

/** Sets one option's sold_out, wherever it is; works on drafts and saved lists. */
export function withSoldOut<G extends { options: { id?: string; sold_out: boolean }[] }>(groups: G[], optionId: string, soldOut: boolean): G[] {
  return groups.map((g) =>
    g.options.some((o) => o.id === optionId)
      ? { ...g, options: g.options.map((o) => (o.id === optionId ? { ...o, sold_out: soldOut } : o)) }
      : g
  );
}

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

/** "4.50" -> 4.5; null unless it's a plain amount with at most 2 decimals. */
export function parseOptionPrice(text: string): number | null {
  const t = text.trim();
  if (t === "") return 0; // a blank price is a free option
  if (!/^\d+(\.\d{1,2})?$/.test(t) && !/^\.\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= MAX_OPTION_PRICE ? n : null;
}

export interface AddonsCheck {
  /** Set when there's nothing to fix. */
  groups: AddonGroupInput[] | null;
  /** By group or option key. */
  errors: Record<string, string>;
  /** About the dish's add-ons as a whole (too many groups). */
  formError: string | null;
}

export function checkAddons(drafts: GroupDraft[]): AddonsCheck {
  const errors: Record<string, string> = {};
  const formError = drafts.length > MAX_GROUPS ? `A dish can have at most ${MAX_GROUPS} add-on groups.` : null;
  const groups: AddonGroupInput[] = [];

  for (const g of drafts) {
    const name = g.name.trim();
    const maxPicks = /^\d+$/.test(g.maxPicks.trim()) ? Number(g.maxPicks.trim()) : NaN;
    if (!name) errors[g.key] = "Give this group a name, e.g. Spice level.";
    else if (name.length > MAX_NAME_LENGTH) errors[g.key] = `Keep the name under ${MAX_NAME_LENGTH} characters.`;
    else if (!(maxPicks >= 1 && maxPicks <= MAX_PICKS)) errors[g.key] = `Max picks must be a whole number from 1 to ${MAX_PICKS}.`;
    else if (g.options.length === 0) errors[g.key] = "Add at least one option, or remove this group.";
    else if (g.options.length > MAX_OPTIONS) errors[g.key] = `A group can have at most ${MAX_OPTIONS} options.`;

    const options: AddonGroupInput["options"] = [];
    for (const o of g.options) {
      const optionName = o.name.trim();
      const price = parseOptionPrice(o.price);
      if (!optionName) errors[o.key] = "Give this option a name, or remove it.";
      else if (optionName.length > MAX_NAME_LENGTH) errors[o.key] = `Keep the name under ${MAX_NAME_LENGTH} characters.`;
      else if (price === null) errors[o.key] = `Price must be from $0 to $${MAX_OPTION_PRICE}, with at most 2 decimals.`;
      else options.push({ ...(o.id ? { id: o.id } : {}), name: optionName, price, sold_out: o.sold_out });
    }
    groups.push({ ...(g.id ? { id: g.id } : {}), name, required: g.required, max_picks: maxPicks, options });
  }

  const ok = !formError && Object.keys(errors).length === 0;
  return { groups: ok ? groups : null, errors, formError };
}

/** Things worth knowing that don't stop a save, by group key. */
export function addonWarnings(drafts: GroupDraft[]): Record<string, string> {
  const warnings: Record<string, string> = {};
  for (const g of drafts) {
    const maxPicks = Number(g.maxPicks.trim());
    const names = g.options.map((o) => o.name.trim().toLowerCase()).filter(Boolean);
    if (g.required && g.options.length > 0 && g.options.every((o) => o.sold_out)) {
      warnings[g.key] = "Every option is sold out, so customers can't order this dish.";
    } else if (Number.isInteger(maxPicks) && g.options.length > 0 && maxPicks > g.options.length) {
      warnings[g.key] = `Max picks is more than the ${g.options.length} option${g.options.length === 1 ? "" : "s"} here.`;
    } else if (new Set(names).size < names.length) {
      warnings[g.key] = "Two options have the same name.";
    }
  }
  return warnings;
}

/** "Customers pick 1", "Customers pick 1–2", "Optional, up to 2". */
export function picksHint(required: boolean, maxPicksText: string): string {
  const n = Number(maxPicksText.trim());
  if (!Number.isInteger(n) || n < 1) return required ? "Customers must pick at least 1" : "Optional";
  if (required) return n === 1 ? "Customers pick 1" : `Customers pick 1–${n}`;
  return `Optional, up to ${n}`;
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

/** Ids dropped: for a dish saved under a new id, its old add-on rows belong to nothing. */
export function withoutIds(groups: AddonGroupInput[]): AddonGroupInput[] {
  return groups.map((g) => ({
    name: g.name,
    required: g.required,
    max_picks: g.max_picks,
    options: g.options.map((o) => ({ name: o.name, price: o.price, sold_out: o.sold_out })),
  }));
}

function comparable(groups: AddonGroupInput[] | SavedGroup[]) {
  return JSON.stringify(
    groups.map((g) => [g.id ?? null, g.name, g.required, g.max_picks, g.options.map((o) => [o.id ?? null, o.name, Number(o.price), o.sold_out])])
  );
}

/** Whether saving `groups` would change the dish's saved add-ons. */
export function addonsChanged(saved: SavedGroup[], groups: AddonGroupInput[]): boolean {
  return comparable(saved) !== comparable(groups);
}

/** One dish's checked add-ons, from the form row `key` (`id` set if the row was loaded or saved). */
export interface AddonJob {
  key: string;
  id?: string;
  name: string;
  groups: AddonGroupInput[];
}

export interface AddonSave {
  key: string;
  name: string;
  menuItemId: string;
  groups: AddonGroupInput[];
}

/**
 * Which dishes' add-ons to save once the dishes themselves are written.
 * `inserts` / `inserted` are the menu save's inserts and the rows it got
 * back, in the same order. A dish that was inserted gets its add-ons as new
 * rows (ids dropped). Dishes whose add-ons didn't change are skipped, so a
 * save that doesn't touch add-ons never calls the database for them.
 * `unresolved`: dishes whose new id isn't known (names), so nothing is sent.
 */
export function planAddonSaves(
  jobs: AddonJob[],
  inserts: { key?: string }[],
  inserted: { id: string }[],
  saved: Record<string, SavedGroup[]>
): { saves: AddonSave[]; unresolved: string[] } {
  const insertedId = new Map<string, string | undefined>();
  inserts.forEach((ins, i) => {
    if (ins.key) insertedId.set(ins.key, inserts.length === inserted.length ? inserted[i]?.id : undefined);
  });

  const saves: AddonSave[] = [];
  const unresolved: string[] = [];
  for (const job of jobs) {
    if (insertedId.has(job.key)) {
      const menuItemId = insertedId.get(job.key);
      if (job.groups.length === 0) continue;
      if (!menuItemId) unresolved.push(job.name);
      else saves.push({ key: job.key, name: job.name, menuItemId, groups: withoutIds(job.groups) });
    } else if (job.id) {
      if (addonsChanged(saved[job.id] ?? [], job.groups)) saves.push({ key: job.key, name: job.name, menuItemId: job.id, groups: job.groups });
    } else if (job.groups.length > 0) {
      unresolved.push(job.name);
    }
  }
  return { saves, unresolved };
}

export const ADDONS_NOT_READY_MESSAGE = "Add-ons can't be saved yet. Please try again later.";

export function describeAddonsError(err: unknown): string {
  const e = (err && typeof err === "object" ? err : {}) as { message?: string; code?: string; details?: string };
  const message = `${e.message ?? ""} ${e.details ?? ""}`;
  if (message.includes("option_not_for_item")) return "Your add-ons were changed somewhere else. Reload the page and try again.";
  if (message.includes("item_not_in_kitchen")) return "This dish isn't on your menu any more. Reload the page and try again.";
  if (message.includes("too_many_groups")) return `A dish can have at most ${MAX_GROUPS} add-on groups.`;
  if (message.includes("too_many_options")) return `A group can have at most ${MAX_OPTIONS} options.`;
  if (message.includes("options_invalid")) return "Some add-on details are missing or wrong. Check the names, prices and max picks.";
  if (message.includes("not_a_cook") || message.includes("not_signed_in")) return "Your session has ended or your account can't edit this kitchen. Please sign in again.";
  if (message.includes("row-level security")) return "Your kitchen can't save add-ons right now. Contact Kopi Boy HQ if this keeps happening.";
  // Function or grants not there yet (the app is deployed before the SQL).
  if (e.code === "PGRST202" || e.code === "42883" || e.code === "42501" || message.includes("permission denied")) {
    return ADDONS_NOT_READY_MESSAGE;
  }
  return e.message?.trim() ? `Couldn't save add-ons: ${e.message.trim()}` : "Something went wrong. Please try again.";
}

export const SOLD_OUT_FAILED_MESSAGE = "Couldn't update this option. Check your connection and try again.";

/**
 * The quick sold-out switch updates menu_options directly; RLS limits it to
 * the cook's own options. An update RLS filters out returns no error, just no
 * rows, so 0 rows is a failure too.
 */
export function describeSoldOutResult(error: { message?: string; code?: string } | null, rows: unknown[] | null): string | null {
  if (error) {
    if (error.code === "42501" || error.message?.includes("permission denied")) return "Sold out can't be changed here yet. Contact Kopi Boy HQ.";
    return SOLD_OUT_FAILED_MESSAGE;
  }
  if (!rows || rows.length === 0) return "This option wasn't found. It may have been removed — reload the page.";
  return null;
}

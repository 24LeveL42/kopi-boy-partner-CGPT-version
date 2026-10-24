/**
 * Promotions & Deals — the cook's own deals (Phase C1).
 *
 * Mirrors public.promotions / public.promotion_items (Customer repo
 * docs/supabase-promotions.sql) and the write rules in this repo's
 * docs/supabase-promotions-partner.sql. Kept free of Next.js and Supabase
 * imports so every rule here can be unit-tested.
 *
 * All times are shown and entered in Singapore time (+08:00, no daylight
 * saving) and sent to the database as ISO timestamps.
 */

export type PromotionKind = "percent_off" | "amount_off" | "buy_x_get_y" | "free_item" | "min_spend" | "limited_qty" | "flash";

export interface Promotion {
  id: string;
  kitchen_id: string;
  kind: PromotionKind;
  title: string;
  description: string | null;
  terms: string | null;
  percent_off: number | null;
  amount_off: number | null;
  buy_qty: number | null;
  get_qty: number | null;
  min_spend: number | null;
  deal_price: number | null;
  free_item_id: string | null;
  quantity_limit: number | null;
  /** Server-owned: place_order counts up, a cancelled/rejected order gives back. */
  quantity_claimed: number;
  per_customer_limit: number | null;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  /** Boss-owned. */
  disabled_by_admin_at: string | null;
  disabled_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** A promotion with its eligible items (none = whole menu) and how many orders used it. */
export interface PromotionWithUsage extends Promotion {
  item_ids: string[];
  order_count: number;
}

/** The menu fields the deal screens need. */
export interface DealMenuItem {
  id: string;
  name: string;
  price: number;
}

/** app_settings as the deal rules see it (public.live_promotions hides deals outside these). */
export interface DealSettings {
  dealsEnabled: boolean;
  maxPercentOff: number;
  maxDealDays: number;
}

/** The column defaults in app_settings — used only if the row can't be read. */
export const DEFAULT_DEAL_SETTINGS: DealSettings = { dealsEnabled: false, maxPercentOff: 50, maxDealDays: 30 };

export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 200;
export const TERMS_MAX = 1000;
/** numeric(7,2) */
export const MONEY_MAX = 99999.99;
/** buy_qty / get_qty check (between 1 and 99) */
export const BUY_GET_MAX = 99;
export const LIMIT_MAX = 99999;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SGT_OFFSET = 8 * HOUR;

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

/** How the discount is given, for the kinds that offer a choice. */
export type DiscountType = "percent" | "amount" | "price";

export interface KindInfo {
  kind: PromotionKind;
  label: string;
  hint: string;
  /** The discount types the kind accepts, first = default. Empty = the kind has its own fields. */
  discountTypes: DiscountType[];
  /** Whether the cook picks eligible items (free_item uses its own free item instead). */
  usesItems: boolean;
}

export const PROMOTION_KINDS: KindInfo[] = [
  { kind: "percent_off", label: "Percent off", hint: "e.g. 20% off chosen items", discountTypes: [], usesItems: true },
  { kind: "amount_off", label: "Amount off", hint: "e.g. $2 off chosen items", discountTypes: [], usesItems: true },
  { kind: "buy_x_get_y", label: "Buy X get Y", hint: "e.g. buy 2, get 1 free", discountTypes: [], usesItems: true },
  { kind: "free_item", label: "Free item", hint: "one dish free when it's in the cart", discountTypes: [], usesItems: false },
  { kind: "min_spend", label: "Minimum spend", hint: "money off once the cart reaches an amount", discountTypes: ["percent", "amount"], usesItems: true },
  { kind: "limited_qty", label: "Limited quantity", hint: "a deal on the first portions sold", discountTypes: ["price", "percent", "amount"], usesItems: true },
  // The Customer app only shows a flash sale that has a deal price
  // (describeDeal in its src/lib/deals.ts), so that's the only choice here.
  { kind: "flash", label: "Flash sale", hint: "a special price for a short time", discountTypes: ["price"], usesItems: true },
];

export function kindInfo(kind: PromotionKind): KindInfo {
  return PROMOTION_KINDS.find((k) => k.kind === kind) ?? PROMOTION_KINDS[0];
}

export function kindLabel(kind: PromotionKind): string {
  return kindInfo(kind).label;
}

/** flash / limited_qty count portions; every other kind counts orders (redemptions). */
export function countsPortions(kind: PromotionKind): boolean {
  return kind === "limited_qty" || kind === "flash";
}

// ---------------------------------------------------------------------------
// Singapore time
// ---------------------------------------------------------------------------

/** A timestamp as a `datetime-local` value in Singapore time ("2026-10-24T15:30"). */
export function toSgtInput(ms: number): string {
  return new Date(ms + SGT_OFFSET).toISOString().slice(0, 16);
}

/** A `datetime-local` value read as Singapore time; null if it isn't one. */
export function fromSgtInput(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}:00+08:00`);
  return Number.isFinite(ms) ? ms : null;
}

/** 23:59 Singapore time on the day of `ms`. */
export function endOfSgtDay(ms: number): number {
  const dayStart = Math.floor((ms + SGT_OFFSET) / DAY) * DAY - SGT_OFFSET;
  return dayStart + DAY - MINUTE;
}

export type QuickEnd = "1h" | "2h" | "today" | "3d" | "7d";

export const QUICK_ENDS: { id: QuickEnd; label: string }[] = [
  { id: "1h", label: "1 hour" },
  { id: "2h", label: "2 hours" },
  { id: "today", label: "End of today" },
  { id: "3d", label: "3 days" },
  { id: "7d", label: "7 days" },
];

/** A quick end choice, counted from the deal's start. */
export function quickEndAt(choice: QuickEnd, startMs: number): number {
  switch (choice) {
    case "1h":
      return startMs + HOUR;
    case "2h":
      return startMs + 2 * HOUR;
    case "today":
      return endOfSgtDay(startMs);
    case "3d":
      return startMs + 3 * DAY;
    case "7d":
      return startMs + 7 * DAY;
  }
}

/** "Sat, 24 Oct, 3:30 pm" in Singapore time. */
export function formatSgt(value: string | number): string {
  const ms = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(ms);
}

/** "25 min", "2 h 15 min", "3 days 4 h". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  const dayText = days === 1 ? "1 day" : `${days} days`;
  return restHours ? `${dayText} ${restHours} h` : dayText;
}

// ---------------------------------------------------------------------------
// Status, list grouping, actions
// ---------------------------------------------------------------------------

export type PromotionStatus = "running" | "upcoming" | "sold_out" | "stopped" | "ended" | "disabled";
export type PromotionGroup = "running" | "upcoming" | "ended";

/** Same order of checks as public.promotion_overview. */
export function promotionStatus(p: Pick<Promotion, "disabled_by_admin_at" | "is_active" | "starts_at" | "ends_at" | "quantity_limit" | "quantity_claimed">, now: number): PromotionStatus {
  if (p.disabled_by_admin_at) return "disabled";
  if (!p.is_active) return "stopped";
  if (Date.parse(p.ends_at) <= now) return "ended";
  if (Date.parse(p.starts_at) > now) return "upcoming";
  if (p.quantity_limit != null && p.quantity_claimed >= p.quantity_limit) return "sold_out";
  return "running";
}

export const STATUS_LABEL: Record<PromotionStatus, string> = {
  running: "Running",
  upcoming: "Upcoming",
  sold_out: "Sold out",
  stopped: "Stopped",
  ended: "Ended",
  disabled: "Disabled by Kopi Boy",
};

export function statusGroup(status: PromotionStatus): PromotionGroup {
  if (status === "running") return "running";
  if (status === "upcoming") return "upcoming";
  return "ended";
}

/** Running (ending soonest first), Upcoming (starting soonest first), Ended (most recent first). */
export function groupPromotions<T extends Promotion>(promotions: T[], now: number): Record<PromotionGroup, T[]> {
  const groups: Record<PromotionGroup, T[]> = { running: [], upcoming: [], ended: [] };
  for (const p of promotions) groups[statusGroup(promotionStatus(p, now))].push(p);
  groups.running.sort((a, b) => Date.parse(a.ends_at) - Date.parse(b.ends_at));
  groups.upcoming.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  groups.ended.sort((a, b) => Date.parse(b.ends_at) - Date.parse(a.ends_at));
  return groups;
}

/** The time line on a deal's card. */
export function timeLabel(p: Promotion, now: number): string {
  const starts = Date.parse(p.starts_at);
  const ends = Date.parse(p.ends_at);
  switch (promotionStatus(p, now)) {
    case "running":
    case "sold_out":
      return `Ends in ${formatDuration(ends - now)} · ${formatSgt(ends)}`;
    case "upcoming":
      return `Starts in ${formatDuration(starts - now)} · ${formatSgt(starts)}`;
    case "stopped":
    case "disabled":
      return ends > now ? `Would end ${formatSgt(ends)}` : `Ended ${formatSgt(ends)}`;
    case "ended":
      return `Ended ${formatSgt(ends)}`;
  }
}

/** "12 of 20 portions left" / "3 of 50 redemptions left"; null when unlimited. */
export function limitLabel(p: Pick<Promotion, "kind" | "quantity_limit" | "quantity_claimed">): string | null {
  if (p.quantity_limit == null) return null;
  const left = Math.max(p.quantity_limit - p.quantity_claimed, 0);
  return `${left} of ${p.quantity_limit} ${countsPortions(p.kind) ? "portions" : "redemptions"} left`;
}

/**
 * A deal that has orders keeps its offer: quantity_claimed can fall back to 0
 * when orders are cancelled, but those orders still point at the deal.
 */
export function isLocked(p: Pick<Promotion, "quantity_claimed">, orderCount: number): boolean {
  return p.quantity_claimed > 0 || orderCount > 0;
}

export function canDelete(p: Pick<Promotion, "quantity_claimed">, orderCount: number): boolean {
  return !isLocked(p, orderCount);
}

export function canStop(p: Pick<Promotion, "is_active" | "disabled_by_admin_at" | "ends_at">, now: number): boolean {
  return p.is_active && !p.disabled_by_admin_at && Date.parse(p.ends_at) > now;
}

/** A stopped deal may be switched on again while its end time is still ahead. */
export function canSwitchOn(p: Pick<Promotion, "is_active" | "disabled_by_admin_at" | "ends_at">, now: number): boolean {
  return !p.is_active && !p.disabled_by_admin_at && Date.parse(p.ends_at) > now;
}

/** HQ-disabled deals are read-only for the cook. */
export function canEdit(p: Pick<Promotion, "disabled_by_admin_at">): boolean {
  return !p.disabled_by_admin_at;
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

export interface PromotionDraft {
  kind: PromotionKind;
  title: string;
  description: string;
  terms: string;
  discountType: DiscountType;
  percentOff: string;
  amountOff: string;
  buyQty: string;
  getQty: string;
  minSpend: string;
  dealPrice: string;
  freeItemId: string;
  itemIds: string[];
  perCustomerLimit: string;
  quantityLimit: string;
  startMode: "now" | "schedule";
  /** datetime-local, Singapore time */
  startAt: string;
  /** datetime-local, Singapore time */
  endAt: string;
}

export type DraftField = keyof PromotionDraft;

export function emptyDraft(now: number): PromotionDraft {
  return {
    kind: "percent_off",
    title: "",
    description: "",
    terms: "",
    discountType: "percent",
    percentOff: "",
    amountOff: "",
    buyQty: "",
    getQty: "",
    minSpend: "",
    dealPrice: "",
    freeItemId: "",
    itemIds: [],
    perCustomerLimit: "",
    quantityLimit: "",
    startMode: "now",
    startAt: toSgtInput(now + HOUR),
    endAt: toSgtInput(endOfSgtDay(now)),
  };
}

const text = (n: number | null) => (n == null ? "" : String(Number(n)));

export function draftFromPromotion(p: Promotion, itemIds: string[]): PromotionDraft {
  const info = kindInfo(p.kind);
  const discountType: DiscountType =
    p.deal_price != null && info.discountTypes.includes("price")
      ? "price"
      : p.amount_off != null && info.discountTypes.includes("amount")
        ? "amount"
        : info.discountTypes.includes("percent")
          ? "percent"
          : (info.discountTypes[0] ?? "percent");
  return {
    kind: p.kind,
    title: p.title,
    description: p.description ?? "",
    terms: p.terms ?? "",
    discountType,
    percentOff: text(p.percent_off),
    amountOff: text(p.amount_off),
    buyQty: text(p.buy_qty),
    getQty: text(p.get_qty),
    minSpend: text(p.min_spend),
    dealPrice: text(p.deal_price),
    freeItemId: p.free_item_id ?? "",
    itemIds: [...itemIds],
    perCustomerLimit: text(p.per_customer_limit),
    quantityLimit: text(p.quantity_limit),
    startMode: "schedule",
    startAt: toSgtInput(Date.parse(p.starts_at)),
    endAt: toSgtInput(Date.parse(p.ends_at)),
  };
}

/** The money side of a deal — locked once it has orders. */
export interface PromotionOffer {
  kind: PromotionKind;
  percent_off: number | null;
  amount_off: number | null;
  buy_qty: number | null;
  get_qty: number | null;
  min_spend: number | null;
  deal_price: number | null;
  free_item_id: string | null;
  quantity_limit: number | null;
  per_customer_limit: number | null;
}

/** What save_my_promotion receives (plus the eligible item ids). */
export interface PromotionInput extends PromotionOffer {
  id?: string;
  title: string;
  description: string | null;
  terms: string | null;
  starts_at: string;
  ends_at: string;
}

export interface ValidationContext {
  now: number;
  settings: DealSettings;
  menu: DealMenuItem[];
  /** The deal being edited, if any. */
  existing?: PromotionWithUsage;
}

export interface ValidationResult {
  errors: Partial<Record<DraftField, string>>;
  value: PromotionInput | null;
  itemIds: string[];
}

/** Money: up to 2 decimals. */
function parseMoney(s: string): number | null {
  const t = s.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Number(t);
}

function parseCount(s: string): number | null {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** The eligible items: the chosen ones, or the whole menu when none are chosen. */
export function eligibleItems(menu: DealMenuItem[], itemIds: string[]): DealMenuItem[] {
  if (itemIds.length === 0) return menu;
  const chosen = new Set(itemIds);
  return menu.filter((m) => chosen.has(m.id));
}

/** Whether start and offer are fixed while editing: a deal with orders, or (start only) one that has already started. */
export function editLocks(existing: PromotionWithUsage | undefined, now: number): { offer: boolean; start: boolean } {
  if (!existing) return { offer: false, start: false };
  const offer = isLocked(existing, existing.order_count);
  return { offer, start: offer || Date.parse(existing.starts_at) <= now };
}

function offerFrom(p: Promotion): PromotionOffer {
  return {
    kind: p.kind,
    percent_off: p.percent_off,
    amount_off: p.amount_off,
    buy_qty: p.buy_qty,
    get_qty: p.get_qty,
    min_spend: p.min_spend,
    deal_price: p.deal_price,
    free_item_id: p.free_item_id,
    quantity_limit: p.quantity_limit,
    per_customer_limit: p.per_customer_limit,
  };
}

/**
 * Hard checks. Everything here mirrors a database check, a rule the Customer
 * app needs to show the deal, or a rule in public.live_promotions (a deal
 * outside max_percent_off / max_deal_days saves but never runs).
 */
export function validatePromotion(draft: PromotionDraft, ctx: ValidationContext): ValidationResult {
  const errors: Partial<Record<DraftField, string>> = {};
  const locks = editLocks(ctx.existing, ctx.now);

  const title = draft.title.trim();
  if (!title) errors.title = "Give your deal a title.";
  else if (title.length > TITLE_MAX) errors.title = `Keep the title to ${TITLE_MAX} characters.`;
  const description = draft.description.trim();
  if (description.length > DESCRIPTION_MAX) errors.description = `Keep the description to ${DESCRIPTION_MAX} characters.`;
  const terms = draft.terms.trim();
  if (terms.length > TERMS_MAX) errors.terms = `Keep the terms to ${TERMS_MAX} characters.`;

  let offer: PromotionOffer;
  let itemIds: string[];
  if (locks.offer && ctx.existing) {
    offer = offerFrom(ctx.existing);
    itemIds = [...ctx.existing.item_ids];
  } else {
    ({ offer, itemIds } = validateOffer(draft, ctx, errors));
  }

  // Timeline
  let startMs: number | null;
  if (locks.start && ctx.existing) {
    startMs = Date.parse(ctx.existing.starts_at);
  } else if (draft.startMode === "now") {
    startMs = ctx.now;
  } else {
    startMs = fromSgtInput(draft.startAt);
    if (startMs == null) errors.startAt = "Pick a start date and time.";
    else if (startMs < ctx.now - MINUTE) errors.startAt = "That start time has passed. Choose Start now or a later time.";
  }
  const endMs = fromSgtInput(draft.endAt);
  if (endMs == null) errors.endAt = "Pick an end date and time.";
  else if (endMs <= ctx.now) errors.endAt = "The end time must be in the future.";
  else if (startMs != null && endMs <= startMs) errors.endAt = "The deal must end after it starts.";
  else if (startMs != null && endMs - startMs > ctx.settings.maxDealDays * DAY) {
    errors.endAt = `A deal can run for at most ${ctx.settings.maxDealDays} ${ctx.settings.maxDealDays === 1 ? "day" : "days"}.`;
  }

  if (Object.keys(errors).length > 0 || startMs == null || endMs == null) {
    return { errors, value: null, itemIds };
  }
  return {
    errors,
    itemIds,
    value: {
      ...(ctx.existing ? { id: ctx.existing.id } : {}),
      ...offer,
      title,
      description: description || null,
      terms: terms || null,
      // A fixed start goes back exactly as stored: through Date it would lose
      // the database's microseconds and look changed to the guard.
      starts_at: locks.start && ctx.existing ? ctx.existing.starts_at : new Date(startMs).toISOString(),
      ends_at: new Date(endMs).toISOString(),
    },
  };
}

function validateOffer(
  draft: PromotionDraft,
  ctx: ValidationContext,
  errors: Partial<Record<DraftField, string>>
): { offer: PromotionOffer; itemIds: string[] } {
  const info = kindInfo(draft.kind);
  const menuIds = new Set(ctx.menu.map((m) => m.id));
  const offer: PromotionOffer = {
    kind: draft.kind,
    percent_off: null,
    amount_off: null,
    buy_qty: null,
    get_qty: null,
    min_spend: null,
    deal_price: null,
    free_item_id: null,
    quantity_limit: null,
    per_customer_limit: null,
  };

  let itemIds: string[] = [];
  if (info.usesItems) {
    itemIds = [...new Set(draft.itemIds)];
    if (itemIds.some((id) => !menuIds.has(id))) errors.itemIds = "One of the chosen items isn't on your menu any more. Untick it and try again.";
  }
  const eligible = eligibleItems(ctx.menu, itemIds);
  if (info.usesItems && eligible.length === 0 && !errors.itemIds) errors.itemIds = "Add items to your menu before creating a deal.";

  const discountType: DiscountType | null = info.discountTypes.length === 0
    ? null
    : info.discountTypes.includes(draft.discountType) ? draft.discountType : info.discountTypes[0];

  const wantPercent = draft.kind === "percent_off" || discountType === "percent";
  const wantAmount = draft.kind === "amount_off" || discountType === "amount";
  const wantPrice = discountType === "price";

  if (wantPercent) {
    const v = parseMoney(draft.percentOff);
    const max = Math.min(100, ctx.settings.maxPercentOff);
    if (v == null || v <= 0) errors.percentOff = "Enter a percentage above 0, e.g. 20.";
    else if (v > max) errors.percentOff = `The percentage can be at most ${max}%.`;
    else offer.percent_off = v;
  }
  if (wantAmount) {
    const v = parseMoney(draft.amountOff);
    if (v == null || v <= 0) errors.amountOff = "Enter an amount above $0, e.g. 2.00.";
    else if (v > MONEY_MAX) errors.amountOff = `The amount can be at most ${money(MONEY_MAX)}.`;
    else offer.amount_off = v;
  }
  if (wantPrice) {
    const v = parseMoney(draft.dealPrice);
    if (v == null || v <= 0) errors.dealPrice = "Enter the deal price, e.g. 4.50.";
    else if (v > MONEY_MAX) errors.dealPrice = `The deal price can be at most ${money(MONEY_MAX)}.`;
    else {
      const tooHigh = eligible.filter((m) => v >= Number(m.price));
      if (tooHigh.length > 0) {
        const names = tooHigh.slice(0, 3).map((m) => `${m.name} (${money(Number(m.price))})`).join(", ");
        errors.dealPrice = `The deal price must be below the item's usual price: ${names}${tooHigh.length > 3 ? "…" : ""}. Choose other items or a lower price.`;
      } else offer.deal_price = v;
    }
  }

  if (draft.kind === "buy_x_get_y") {
    const buy = parseCount(draft.buyQty);
    const get = parseCount(draft.getQty);
    if (buy == null || buy < 1 || buy > BUY_GET_MAX) errors.buyQty = `Enter how many to buy (1–${BUY_GET_MAX}).`;
    else offer.buy_qty = buy;
    if (get == null || get < 1 || get > BUY_GET_MAX) errors.getQty = `Enter how many are free (1–${BUY_GET_MAX}).`;
    else offer.get_qty = get;
  }

  if (draft.kind === "free_item") {
    if (!draft.freeItemId) errors.freeItemId = "Choose the free item.";
    else if (!menuIds.has(draft.freeItemId)) errors.freeItemId = "That item isn't on your menu any more. Choose another.";
    else offer.free_item_id = draft.freeItemId;
  }

  // min_spend: required for the Minimum spend kind, optional for these three.
  if (draft.kind === "min_spend" || ((draft.kind === "percent_off" || draft.kind === "amount_off" || draft.kind === "free_item") && draft.minSpend.trim())) {
    const v = parseMoney(draft.minSpend);
    if (v == null || v <= 0) errors.minSpend = "Enter the minimum spend, e.g. 20.00.";
    else if (v > MONEY_MAX) errors.minSpend = `The minimum spend can be at most ${money(MONEY_MAX)}.`;
    else offer.min_spend = v;
  }

  // quantity_limit: required for Limited quantity (the Customer app only
  // shows it with portions left), optional for everything else.
  if (draft.kind === "limited_qty" || draft.quantityLimit.trim()) {
    const v = parseCount(draft.quantityLimit);
    if (v == null || v < 1 || v > LIMIT_MAX) {
      errors.quantityLimit = draft.kind === "limited_qty"
        ? `Enter how many portions are on offer (1–${LIMIT_MAX}).`
        : `Enter a whole number from 1 to ${LIMIT_MAX}, or leave it empty.`;
    } else offer.quantity_limit = v;
  }
  if (draft.perCustomerLimit.trim()) {
    const v = parseCount(draft.perCustomerLimit);
    if (v == null || v < 1 || v > LIMIT_MAX) errors.perCustomerLimit = `Enter a whole number from 1 to ${LIMIT_MAX}, or leave it empty.`;
    else offer.per_customer_limit = v;
  }

  return { offer, itemIds };
}

// ---------------------------------------------------------------------------
// Soft warnings — shown, never blocking
// ---------------------------------------------------------------------------

/** One unit's price after the deal, for the kinds that discount per unit. Null when the kind doesn't work per unit. */
function priceAfter(offer: PromotionOffer, price: number): number | null {
  if (offer.deal_price != null) return offer.deal_price;
  if (offer.percent_off != null) return Math.round(price * (100 - offer.percent_off)) / 100;
  if (offer.amount_off != null) return Math.max(price - offer.amount_off, 0);
  return null;
}

export function promotionWarnings(value: PromotionInput, itemIds: string[], menu: DealMenuItem[]): string[] {
  const warnings: string[] = [];
  const eligible = value.kind === "free_item" ? [] : eligibleItems(menu, itemIds);

  let big = value.percent_off != null && value.percent_off > 50;
  if (value.kind === "buy_x_get_y" && value.buy_qty && value.get_qty && value.get_qty > value.buy_qty) big = true;
  for (const m of eligible) {
    const after = priceAfter(value, Number(m.price));
    if (after != null && after < Number(m.price) / 2) big = true;
  }
  if (big) warnings.push("This is more than 50% off. Make sure that's what you mean.");

  const cheap = eligible
    .map((m) => ({ m, after: priceAfter(value, Number(m.price)) }))
    .filter((x): x is { m: DealMenuItem; after: number } => x.after != null && x.after < 1);
  if (cheap.length > 0) {
    const sample = cheap.slice(0, 2).map((x) => `${x.m.name} ${money(x.after)}`).join(", ");
    warnings.push(`Some items would cost less than $1.00: ${sample}${cheap.length > 2 ? "…" : ""}.`);
  }

  const length = Date.parse(value.ends_at) - Date.parse(value.starts_at);
  if (length < 30 * MINUTE) warnings.push(`This deal runs for only ${formatDuration(length)}.`);

  if (value.kind === "flash" && value.quantity_limit == null) warnings.push("Flash sales usually have a portion limit, so you don't sell more than you can cook.");

  return warnings;
}

// ---------------------------------------------------------------------------
// Preview — the same wording as the Customer app's describeDeal
// ---------------------------------------------------------------------------

export interface DealPreview {
  label: string;
  detail: string | null;
  example: { name: string; was: number; now: number } | null;
}

/**
 * Built from the draft as it is (unfinished fields are just left out), so the
 * card updates while the cook types. Null when there's nothing to show yet —
 * the Customer app wouldn't show such a deal either.
 */
export function previewDeal(draft: PromotionDraft, menu: DealMenuItem[], quantityClaimed = 0): DealPreview | null {
  const info = kindInfo(draft.kind);
  const discountType = info.discountTypes.includes(draft.discountType) ? draft.discountType : info.discountTypes[0];
  const num = (s: string) => {
    const v = parseMoney(s);
    return v != null && v > 0 ? v : null;
  };
  const percentOff = draft.kind === "percent_off" || discountType === "percent" ? num(draft.percentOff) : null;
  const amountOff = draft.kind === "amount_off" || discountType === "amount" ? num(draft.amountOff) : null;
  const dealPrice = discountType === "price" ? num(draft.dealPrice) : null;
  const minSpend = draft.kind === "min_spend" || draft.kind === "percent_off" || draft.kind === "amount_off" || draft.kind === "free_item" ? num(draft.minSpend) : null;
  const limit = parseCount(draft.quantityLimit);
  const remaining = limit != null && limit > 0 ? Math.max(limit - quantityClaimed, 0) : null;

  const chosen = info.usesItems ? eligibleItems(menu, draft.itemIds) : [];
  const freeItem = menu.find((m) => m.id === draft.freeItemId) ?? null;
  // Like active_deals.item_name: the free item, or the one eligible item when there's exactly one.
  const single = draft.kind === "free_item" ? freeItem : draft.itemIds.length === 1 ? (chosen[0] ?? null) : null;
  const item = single?.name.trim() || null;
  const onItem = item ? ` ${item}` : "";
  const spend = minSpend ? ` when you spend ${money(minSpend)}` : "";
  const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, "")}%`;
  const off = percentOff ? `${pct(percentOff)} off` : amountOff ? `${money(amountOff)} off` : null;
  const left = remaining != null && remaining > 0 ? `Only ${remaining} left` : null;

  let label: string | null = null;
  let detail: string | null = left;
  switch (draft.kind) {
    case "percent_off":
    case "amount_off":
      label = off ? `${off}${onItem}${spend}` : null;
      break;
    case "buy_x_get_y": {
      const buy = parseCount(draft.buyQty);
      const get = parseCount(draft.getQty);
      label = buy && get ? `Buy ${buy}${onItem}, get ${get} free` : null;
      break;
    }
    case "free_item":
      label = item ? `Free ${item}${spend}` : null;
      break;
    case "min_spend":
      label = off && spend ? `${off}${spend}` : null;
      break;
    case "limited_qty": {
      const offer = off ? `${off}${onItem}` : item && dealPrice ? `${item} ${money(dealPrice)}` : null;
      label = offer && left ? offer : null;
      break;
    }
    case "flash": {
      if (dealPrice) {
        label = `${item ?? (draft.title.trim() || "Flash sale")} ${money(dealPrice)}`;
        const was = single && Number(single.price) > dealPrice ? `Usually ${money(Number(single.price))}` : null;
        detail = [was, left].filter(Boolean).join(" · ") || null;
      }
      break;
    }
  }
  if (!label) return null;

  let example: DealPreview["example"] = null;
  const sample = draft.kind === "free_item" ? freeItem : (chosen[0] ?? null);
  if (sample) {
    const was = Number(sample.price);
    const perUnit = draft.kind === "percent_off" || draft.kind === "amount_off" || draft.kind === "min_spend" || draft.kind === "limited_qty" || draft.kind === "flash";
    const after = draft.kind === "free_item" ? 0 : perUnit ? priceAfter({ ...EMPTY_OFFER, percent_off: percentOff, amount_off: amountOff, deal_price: dealPrice }, was) : null;
    if (after != null && after < was) example = { name: sample.name, was, now: after };
  }
  return { label, detail, example };
}

const EMPTY_OFFER: PromotionOffer = {
  kind: "percent_off",
  percent_off: null,
  amount_off: null,
  buy_qty: null,
  get_qty: null,
  min_spend: null,
  deal_price: null,
  free_item_id: null,
  quantity_limit: null,
  per_customer_limit: null,
};

// ---------------------------------------------------------------------------
// Errors from the database
// ---------------------------------------------------------------------------

export const DEALS_NOT_READY_MESSAGE = "Deals can't be saved yet. Kopi Boy is still switching this on. Please try again later.";

/**
 * Turns a Supabase / Postgres error into words for the cook. The codes come
 * from the guards in docs/supabase-promotions-partner.sql.
 */
export function describePromotionError(err: unknown): string {
  const e = (err && typeof err === "object" ? err : {}) as { message?: string; code?: string; details?: string };
  const message = `${e.message ?? ""} ${e.details ?? ""}`;
  if (message.includes("promotion_locked")) {
    return "Customers have ordered with this deal, so its offer can't change. You can still edit the title, description, terms and end time, or stop it.";
  }
  if (message.includes("promotion_has_orders")) return "This deal has orders, so it can't be deleted. Stop it instead.";
  if (message.includes("item_not_in_kitchen")) return "One of the chosen items isn't on your menu any more. Reload the page and try again.";
  if (message.includes("promotion_ended")) return "The end time must be in the future.";
  if (message.includes("promotion_invalid")) return "Some of the deal's details are missing. Check the offer and try again.";
  if (message.includes("promotion_not_found")) return "This deal couldn't be found. It may have been deleted.";
  if (message.includes("row-level security")) return "Your kitchen can't save deals right now. Contact Kopi Boy HQ if this keeps happening.";
  // Function or grants not there yet (the app is deployed before the SQL).
  if (e.code === "PGRST202" || e.code === "42883" || e.code === "42501" || message.includes("permission denied")) {
    return DEALS_NOT_READY_MESSAGE;
  }
  return e.message?.trim() ? `Couldn't save the deal: ${e.message.trim()}` : "Something went wrong. Please try again.";
}

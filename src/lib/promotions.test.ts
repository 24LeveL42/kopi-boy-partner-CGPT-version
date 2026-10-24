import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEALS_NOT_READY_MESSAGE,
  canDelete,
  canStop,
  canSwitchOn,
  describePromotionError,
  draftFromPromotion,
  editLocks,
  emptyDraft,
  endOfSgtDay,
  formatDuration,
  fromSgtInput,
  groupPromotions,
  isLocked,
  limitLabel,
  previewDeal,
  promotionStatus,
  promotionWarnings,
  quickEndAt,
  toSgtInput,
  validatePromotion,
  type DealMenuItem,
  type DealSettings,
  type PromotionDraft,
  type PromotionWithUsage,
} from "./promotions.ts";

// 07:30 UTC = 3:30 pm Singapore.
const NOW = Date.parse("2026-10-24T07:30:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SETTINGS: DealSettings = { dealsEnabled: true, maxPercentOff: 100, maxDealDays: 365 };
const MENU: DealMenuItem[] = [
  { id: "rice", name: "Chicken Rice", price: 5 },
  { id: "noodle", name: "Laksa", price: 7.5 },
  { id: "tea", name: "Teh", price: 1.2 },
];

function draft(overrides: Partial<PromotionDraft> = {}): PromotionDraft {
  return {
    ...emptyDraft(NOW),
    title: "Lunch special",
    percentOff: "20",
    startMode: "now",
    endAt: toSgtInput(NOW + 2 * HOUR),
    ...overrides,
  };
}

function promotion(overrides: Partial<PromotionWithUsage> = {}): PromotionWithUsage {
  return {
    id: "p1",
    kitchen_id: "k1",
    kind: "percent_off",
    title: "Lunch special",
    description: null,
    terms: null,
    percent_off: 20,
    amount_off: null,
    buy_qty: null,
    get_qty: null,
    min_spend: null,
    deal_price: null,
    free_item_id: null,
    quantity_limit: null,
    quantity_claimed: 0,
    per_customer_limit: null,
    starts_at: new Date(NOW - HOUR).toISOString(),
    ends_at: new Date(NOW + HOUR).toISOString(),
    is_active: true,
    disabled_by_admin_at: null,
    disabled_reason: null,
    created_at: new Date(NOW - DAY).toISOString(),
    updated_at: new Date(NOW - DAY).toISOString(),
    item_ids: [],
    order_count: 0,
    ...overrides,
  };
}

const validate = (d: PromotionDraft, existing?: PromotionWithUsage, settings = SETTINGS) =>
  validatePromotion(d, { now: NOW, settings, menu: MENU, existing });

describe("Singapore time", () => {
  it("shows and reads datetime-local values in Singapore time", () => {
    assert.equal(toSgtInput(NOW), "2026-10-24T15:30");
    assert.equal(fromSgtInput("2026-10-24T15:30"), NOW);
    assert.equal(fromSgtInput(toSgtInput(NOW + 17 * 60_000)), NOW + 17 * 60_000);
  });

  it("rejects anything that isn't a datetime-local value", () => {
    assert.equal(fromSgtInput(""), null);
    assert.equal(fromSgtInput("2026-10-24"), null);
    assert.equal(fromSgtInput("24/10/2026 15:30"), null);
  });

  it("ends the day at 23:59 Singapore time, also just after midnight", () => {
    assert.equal(new Date(endOfSgtDay(NOW)).toISOString(), "2026-10-24T15:59:00.000Z");
    // 00:30 on the 25th in Singapore is still the 24th in UTC.
    assert.equal(new Date(endOfSgtDay(Date.parse("2026-10-24T16:30:00Z"))).toISOString(), "2026-10-25T15:59:00.000Z");
  });

  it("counts quick end choices from the start", () => {
    assert.equal(quickEndAt("1h", NOW), NOW + HOUR);
    assert.equal(quickEndAt("2h", NOW), NOW + 2 * HOUR);
    assert.equal(quickEndAt("3d", NOW), NOW + 3 * DAY);
    assert.equal(quickEndAt("7d", NOW), NOW + 7 * DAY);
    assert.equal(toSgtInput(quickEndAt("today", NOW)), "2026-10-24T23:59");
  });

  it("formats durations", () => {
    assert.equal(formatDuration(25 * 60_000), "25 min");
    assert.equal(formatDuration(2 * HOUR + 15 * 60_000), "2 h 15 min");
    assert.equal(formatDuration(3 * HOUR), "3 h");
    assert.equal(formatDuration(DAY + 4 * HOUR), "1 day 4 h");
    assert.equal(formatDuration(3 * DAY), "3 days");
  });
});

describe("promotionStatus and grouping", () => {
  it("checks in the same order as promotion_overview", () => {
    assert.equal(promotionStatus(promotion(), NOW), "running");
    assert.equal(promotionStatus(promotion({ starts_at: new Date(NOW + HOUR).toISOString(), ends_at: new Date(NOW + 2 * HOUR).toISOString() }), NOW), "upcoming");
    assert.equal(promotionStatus(promotion({ ends_at: new Date(NOW).toISOString() }), NOW), "ended");
    assert.equal(promotionStatus(promotion({ quantity_limit: 5, quantity_claimed: 5 }), NOW), "sold_out");
    assert.equal(promotionStatus(promotion({ is_active: false }), NOW), "stopped");
    assert.equal(promotionStatus(promotion({ is_active: false, disabled_by_admin_at: new Date(NOW).toISOString() }), NOW), "disabled");
  });

  it("groups into Running, Upcoming and Ended, each in a useful order", () => {
    const soon = promotion({ id: "soon", ends_at: new Date(NOW + HOUR).toISOString() });
    const later = promotion({ id: "later", ends_at: new Date(NOW + 5 * HOUR).toISOString() });
    const upcoming = promotion({ id: "up", starts_at: new Date(NOW + HOUR).toISOString(), ends_at: new Date(NOW + 9 * HOUR).toISOString() });
    const stopped = promotion({ id: "stopped", is_active: false });
    const soldOut = promotion({ id: "sold", quantity_limit: 1, quantity_claimed: 1 });
    const g = groupPromotions([later, upcoming, stopped, soon, soldOut], NOW);
    assert.deepEqual(g.running.map((p) => p.id), ["soon", "later"]);
    assert.deepEqual(g.upcoming.map((p) => p.id), ["up"]);
    assert.deepEqual(g.ended.map((p) => p.id).sort(), ["sold", "stopped"]);
  });

  it("labels portions for limited quantity and flash, redemptions for the rest", () => {
    assert.equal(limitLabel(promotion({ kind: "flash", quantity_limit: 20, quantity_claimed: 8 })), "12 of 20 portions left");
    assert.equal(limitLabel(promotion({ kind: "limited_qty", quantity_limit: 5, quantity_claimed: 9 })), "0 of 5 portions left");
    assert.equal(limitLabel(promotion({ kind: "percent_off", quantity_limit: 50, quantity_claimed: 3 })), "47 of 50 redemptions left");
    assert.equal(limitLabel(promotion()), null);
  });
});

describe("locks and actions", () => {
  it("locks a deal with orders even after cancellations gave the count back", () => {
    assert.equal(isLocked(promotion({ quantity_claimed: 0 }), 0), false);
    assert.equal(isLocked(promotion({ quantity_claimed: 2 }), 0), true);
    assert.equal(isLocked(promotion({ quantity_claimed: 0 }), 1), true);
    assert.equal(canDelete(promotion(), 0), true);
    assert.equal(canDelete(promotion(), 3), false);
  });

  it("stops a live deal and switches a stopped one back on only before its end", () => {
    assert.equal(canStop(promotion(), NOW), true);
    assert.equal(canStop(promotion({ is_active: false }), NOW), false);
    assert.equal(canSwitchOn(promotion({ is_active: false }), NOW), true);
    assert.equal(canSwitchOn(promotion({ is_active: false, ends_at: new Date(NOW - 1).toISOString() }), NOW), false);
    assert.equal(canSwitchOn(promotion({ is_active: false, disabled_by_admin_at: new Date(NOW).toISOString() }), NOW), false);
  });

  it("fixes the start once a deal has started or has orders", () => {
    assert.deepEqual(editLocks(undefined, NOW), { offer: false, start: false });
    assert.deepEqual(editLocks(promotion(), NOW), { offer: false, start: true });
    assert.deepEqual(editLocks(promotion({ starts_at: new Date(NOW + HOUR).toISOString(), ends_at: new Date(NOW + 2 * HOUR).toISOString() }), NOW), { offer: false, start: false });
    assert.deepEqual(editLocks(promotion({ order_count: 1 }), NOW), { offer: true, start: true });
  });
});

describe("validatePromotion", () => {
  it("builds a percent-off deal with only its own fields", () => {
    const { errors, value, itemIds } = validate(draft({ itemIds: ["rice"], minSpend: "10" }));
    assert.deepEqual(errors, {});
    assert.ok(value);
    assert.equal(value.kind, "percent_off");
    assert.equal(value.percent_off, 20);
    assert.equal(value.min_spend, 10);
    assert.equal(value.amount_off, null);
    assert.equal(value.deal_price, null);
    assert.equal(value.free_item_id, null);
    assert.equal(value.starts_at, new Date(NOW).toISOString());
    assert.equal(value.ends_at, new Date(NOW + 2 * HOUR).toISOString());
    assert.deepEqual(itemIds, ["rice"]);
  });

  it("requires a title within 60 characters and trims text", () => {
    assert.ok(validate(draft({ title: "   " })).errors.title);
    assert.ok(validate(draft({ title: "x".repeat(61) })).errors.title);
    const { value } = validate(draft({ title: "  Hi  ", description: "  ", terms: " T " }));
    assert.equal(value?.title, "Hi");
    assert.equal(value?.description, null);
    assert.equal(value?.terms, "T");
  });

  it("checks the percentage against the live max_percent_off", () => {
    assert.ok(validate(draft({ percentOff: "0" })).errors.percentOff);
    assert.ok(validate(draft({ percentOff: "101" })).errors.percentOff);
    assert.ok(validate(draft({ percentOff: "12.345" })).errors.percentOff);
    assert.equal(validate(draft({ percentOff: "60" })).errors.percentOff, undefined);
    assert.ok(validate(draft({ percentOff: "60" }), undefined, { ...SETTINGS, maxPercentOff: 50 }).errors.percentOff);
  });

  it("needs a minimum spend and one discount for Minimum spend", () => {
    assert.ok(validate(draft({ kind: "min_spend", discountType: "amount", amountOff: "3" })).errors.minSpend);
    const { value } = validate(draft({ kind: "min_spend", discountType: "amount", amountOff: "3", minSpend: "20", percentOff: "50" }));
    assert.equal(value?.amount_off, 3);
    assert.equal(value?.percent_off, null); // only the chosen discount goes out
    assert.equal(value?.min_spend, 20);
  });

  it("needs buy and get quantities from 1 to 99", () => {
    assert.ok(validate(draft({ kind: "buy_x_get_y", buyQty: "0", getQty: "1" })).errors.buyQty);
    assert.ok(validate(draft({ kind: "buy_x_get_y", buyQty: "2", getQty: "100" })).errors.getQty);
    const { value } = validate(draft({ kind: "buy_x_get_y", buyQty: "2", getQty: "1" }));
    assert.equal(value?.buy_qty, 2);
    assert.equal(value?.get_qty, 1);
    assert.equal(value?.percent_off, null);
  });

  it("needs a free item from this menu and sends no eligible items", () => {
    assert.ok(validate(draft({ kind: "free_item" })).errors.freeItemId);
    assert.ok(validate(draft({ kind: "free_item", freeItemId: "gone" })).errors.freeItemId);
    const { value, itemIds } = validate(draft({ kind: "free_item", freeItemId: "tea", itemIds: ["rice"] }));
    assert.equal(value?.free_item_id, "tea");
    assert.deepEqual(itemIds, []);
  });

  it("needs portions for Limited quantity and keeps the deal price below every eligible price", () => {
    assert.ok(validate(draft({ kind: "limited_qty", discountType: "price", dealPrice: "3" , itemIds: ["rice"] })).errors.quantityLimit);
    const tooHigh = validate(draft({ kind: "limited_qty", discountType: "price", dealPrice: "5", itemIds: ["rice"], quantityLimit: "10" }));
    assert.match(tooHigh.errors.dealPrice ?? "", /Chicken Rice/);
    // Whole menu includes the $1.20 Teh.
    assert.ok(validate(draft({ kind: "limited_qty", discountType: "price", dealPrice: "3", quantityLimit: "10" })).errors.dealPrice);
    const ok = validate(draft({ kind: "limited_qty", discountType: "price", dealPrice: "3", itemIds: ["rice", "noodle"], quantityLimit: "10" }));
    assert.deepEqual(ok.errors, {});
    assert.equal(ok.value?.deal_price, 3);
    assert.equal(ok.value?.quantity_limit, 10);
  });

  it("only offers a deal price for a flash sale (the Customer app shows nothing else)", () => {
    const { value } = validate(draft({ kind: "flash", discountType: "percent", percentOff: "30", dealPrice: "4", itemIds: ["rice"] }));
    assert.equal(value?.deal_price, 4);
    assert.equal(value?.percent_off, null);
  });

  it("rejects an unknown item and optional limits that aren't whole numbers", () => {
    assert.ok(validate(draft({ itemIds: ["gone"] })).errors.itemIds);
    assert.ok(validate(draft({ perCustomerLimit: "1.5" })).errors.perCustomerLimit);
    assert.ok(validate(draft({ quantityLimit: "0" })).errors.quantityLimit);
    assert.equal(validate(draft({ perCustomerLimit: "2" })).value?.per_customer_limit, 2);
  });

  it("checks the timeline", () => {
    assert.ok(validate(draft({ endAt: toSgtInput(NOW - HOUR) })).errors.endAt);
    assert.ok(validate(draft({ endAt: "" })).errors.endAt);
    const scheduled = { startMode: "schedule" as const, startAt: toSgtInput(NOW + 3 * HOUR) };
    assert.match(validate(draft({ ...scheduled, endAt: toSgtInput(NOW + 2 * HOUR) })).errors.endAt ?? "", /after it starts/);
    assert.ok(validate(draft({ startMode: "schedule", startAt: toSgtInput(NOW - HOUR) })).errors.startAt);
    assert.equal(validate(draft({ ...scheduled, endAt: toSgtInput(NOW + 4 * HOUR) })).value?.starts_at, new Date(NOW + 3 * HOUR).toISOString());
  });

  it("checks the length against the live max_deal_days", () => {
    const long = draft({ endAt: toSgtInput(NOW + 31 * DAY) });
    assert.equal(validate(long).errors.endAt, undefined);
    assert.match(validate(long, undefined, { ...SETTINGS, maxDealDays: 30 }).errors.endAt ?? "", /30 days/);
  });

  it("keeps the offer, items, limits and start of a deal with orders, whatever the form says", () => {
    const existing = promotion({ order_count: 2, item_ids: ["rice"], quantity_limit: 40, per_customer_limit: 1 });
    const d = { ...draftFromPromotion(existing, existing.item_ids), percentOff: "90", itemIds: [], quantityLimit: "", title: "New title", endAt: toSgtInput(NOW + 5 * HOUR) };
    const { errors, value, itemIds } = validate(d, existing);
    assert.deepEqual(errors, {});
    assert.equal(value?.id, "p1");
    assert.equal(value?.percent_off, 20);
    assert.equal(value?.quantity_limit, 40);
    assert.equal(value?.per_customer_limit, 1);
    assert.equal(value?.starts_at, existing.starts_at);
    assert.equal(value?.title, "New title");
    assert.equal(value?.ends_at, new Date(NOW + 5 * HOUR).toISOString());
    assert.deepEqual(itemIds, ["rice"]);
  });

  it("sends a fixed start back exactly as stored, microseconds and all", () => {
    const stored = "2026-10-24T06:30:00.123456+00:00";
    const existing = promotion({ order_count: 1, starts_at: stored });
    assert.equal(validate(draftFromPromotion(existing, []), existing).value?.starts_at, stored);
    const running = promotion({ starts_at: stored }); // started, no orders
    assert.equal(validate(draftFromPromotion(running, []), running).value?.starts_at, stored);
  });

  it("doesn't re-check a locked offer against settings that changed since", () => {
    const existing = promotion({ order_count: 1, percent_off: 80 });
    const { errors } = validate(draftFromPromotion(existing, []), existing, { ...SETTINGS, maxPercentOff: 50 });
    assert.equal(errors.percentOff, undefined);
  });
});

describe("promotionWarnings", () => {
  const warn = (d: PromotionDraft) => {
    const { value, itemIds } = validate(d);
    assert.ok(value);
    return promotionWarnings(value, itemIds, MENU);
  };

  it("has nothing to say about an ordinary deal", () => {
    assert.deepEqual(warn(draft({ itemIds: ["rice", "noodle"] })), []);
  });

  it("warns about more than 50% off", () => {
    assert.match(warn(draft({ percentOff: "60", itemIds: ["rice"] })).join(" "), /more than 50%/);
    assert.match(warn(draft({ kind: "buy_x_get_y", buyQty: "1", getQty: "2", itemIds: ["rice"] })).join(" "), /more than 50%/);
  });

  it("warns when an item would cost less than $1.00", () => {
    assert.match(warn(draft({ percentOff: "20" })).join(" "), /Teh \$0\.96/);
  });

  it("warns about a very short deal", () => {
    assert.match(warn(draft({ itemIds: ["rice"], endAt: toSgtInput(NOW + 20 * 60_000) })).join(" "), /only 20 min/);
  });

  it("suggests a portion limit for a flash sale", () => {
    assert.match(warn(draft({ kind: "flash", dealPrice: "4", itemIds: ["rice"] })).join(" "), /portion limit/);
  });
});

describe("previewDeal", () => {
  it("uses the Customer app's wording", () => {
    assert.equal(previewDeal(draft({ itemIds: ["rice"] }), MENU)?.label, "20% off Chicken Rice");
    assert.equal(previewDeal(draft({ kind: "amount_off", amountOff: "2", minSpend: "15" }), MENU)?.label, "$2.00 off when you spend $15.00");
    assert.equal(previewDeal(draft({ kind: "buy_x_get_y", buyQty: "2", getQty: "1" }), MENU)?.label, "Buy 2, get 1 free");
    assert.equal(previewDeal(draft({ kind: "free_item", freeItemId: "tea" }), MENU)?.label, "Free Teh");
    const flash = previewDeal(draft({ kind: "flash", dealPrice: "3.5", itemIds: ["noodle"], quantityLimit: "10" }), MENU);
    assert.equal(flash?.label, "Laksa $3.50");
    assert.equal(flash?.detail, "Usually $7.50 · Only 10 left");
    assert.deepEqual(flash?.example, { name: "Laksa", was: 7.5, now: 3.5 });
  });

  it("is empty until the offer is filled in, like the Customer app", () => {
    assert.equal(previewDeal(draft({ percentOff: "" }), MENU), null);
    assert.equal(previewDeal(draft({ kind: "min_spend", discountType: "percent" }), MENU), null);
    assert.equal(previewDeal(draft({ kind: "limited_qty", discountType: "percent", percentOff: "10" }), MENU), null); // no portions left to show
  });
});

describe("describePromotionError", () => {
  it("explains the guard errors", () => {
    assert.match(describePromotionError({ message: "promotion_locked" }), /ordered with this deal/);
    assert.match(describePromotionError({ message: "promotion_has_orders" }), /Stop it instead/);
    assert.match(describePromotionError({ message: "item_not_in_kitchen" }), /isn't on your menu/);
  });

  it("says deals aren't ready while the SQL hasn't run", () => {
    assert.equal(describePromotionError({ code: "PGRST202", message: "Could not find the function" }), DEALS_NOT_READY_MESSAGE);
    assert.equal(describePromotionError({ code: "42501", message: "permission denied for table promotions" }), DEALS_NOT_READY_MESSAGE);
  });
});

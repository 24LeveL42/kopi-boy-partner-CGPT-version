import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ADDONS_NOT_READY_MESSAGE,
  addonWarnings,
  addonsByItem,
  addonsChanged,
  checkAddons,
  describeAddonsError,
  describeSoldOutResult,
  draftsFromSaved,
  draftsWithSavedIds,
  parseOptionPrice,
  parseSavedGroups,
  picksHint,
  planAddonSaves,
  withSoldOut,
  withoutIds,
  type GroupDraft,
  type SavedGroup,
} from "./menu-addons.ts";

const SPICE: SavedGroup = {
  id: "g1",
  name: "Spice level",
  required: true,
  max_picks: 1,
  options: [
    { id: "o1", name: "Mild", price: 0, sold_out: false },
    { id: "o2", name: "Hot", price: 0, sold_out: false },
  ],
};
const EXTRAS: SavedGroup = {
  id: "g2",
  name: "Extras",
  required: false,
  max_picks: 3,
  options: [{ id: "o3", name: "Extra egg", price: 1, sold_out: false }],
};

function group(patch: Partial<GroupDraft> = {}): GroupDraft {
  return {
    key: "gk",
    name: "Extras",
    required: false,
    maxPicks: "2",
    options: [
      { key: "ok1", name: "Egg", price: "1", sold_out: false },
      { key: "ok2", name: "Tofu", price: "1.50", sold_out: false },
    ],
    ...patch,
  };
}

describe("addonsByItem", () => {
  it("groups rows by dish and sorts groups and options", () => {
    const out = addonsByItem([
      {
        id: "g2", menu_item_id: "a", name: "Extras", required: false, max_picks: 3, sort_order: 1,
        menu_options: [{ id: "o3", name: "Extra egg", price: "1.00", sold_out: false, sort_order: 0 }],
      },
      {
        id: "g1", menu_item_id: "a", name: "Spice level", required: true, max_picks: 1, sort_order: 0,
        menu_options: [
          { id: "o2", name: "Hot", price: "0", sold_out: false, sort_order: 1 },
          { id: "o1", name: "Mild", price: 0, sold_out: false, sort_order: 0 },
        ],
      },
      { id: "g9", menu_item_id: "b", name: "Size", required: true, max_picks: 1, sort_order: 0, menu_options: null },
    ]);
    assert.deepEqual(out.a, [SPICE, EXTRAS]);
    assert.deepEqual(out.b, [{ id: "g9", name: "Size", required: true, max_picks: 1, options: [] }]);
  });
});

describe("parseOptionPrice", () => {
  it("accepts amounts from 0 to 999 with at most 2 decimals", () => {
    assert.equal(parseOptionPrice("0"), 0);
    assert.equal(parseOptionPrice(""), 0); // blank = free
    assert.equal(parseOptionPrice(" 1.5 "), 1.5);
    assert.equal(parseOptionPrice(".50"), 0.5);
    assert.equal(parseOptionPrice("999"), 999);
  });

  it("rejects anything else", () => {
    for (const bad of ["-1", "1000", "1.234", "abc", "1,50", "1e2", "$1"]) {
      assert.equal(parseOptionPrice(bad), null, bad);
    }
  });
});

describe("checkAddons", () => {
  it("turns valid drafts into the payload, in order, keeping ids", () => {
    const check = checkAddons([
      group({ id: "g2", key: "g2", name: "  Extras ", options: [{ key: "o3", id: "o3", name: " Egg ", price: "1", sold_out: true }] }),
      group({ key: "new", name: "Size", required: true, maxPicks: "1", options: [{ key: "n1", name: "Large", price: "", sold_out: false }] }),
    ]);
    assert.deepEqual(check.errors, {});
    assert.equal(check.formError, null);
    assert.deepEqual(check.groups, [
      { id: "g2", name: "Extras", required: false, max_picks: 2, options: [{ id: "o3", name: "Egg", price: 1, sold_out: true }] },
      { name: "Size", required: true, max_picks: 1, options: [{ name: "Large", price: 0, sold_out: false }] },
    ]);
  });

  it("flags names, max picks, empty groups and bad prices by key", () => {
    const check = checkAddons([
      group({ key: "a", name: " " }),
      group({ key: "b", maxPicks: "0" }),
      group({ key: "c", maxPicks: "21" }),
      group({ key: "d", maxPicks: "1.5" }),
      group({ key: "e", options: [] }),
      group({ key: "f", options: [{ key: "x1", name: "", price: "1", sold_out: false }, { key: "x2", name: "Egg", price: "-2", sold_out: false }] }),
      group({ key: "g", name: "x".repeat(61), options: [{ key: "x3", name: "Egg", price: "1000", sold_out: false }] }),
    ]);
    assert.equal(check.groups, null);
    assert.deepEqual(Object.keys(check.errors).sort(), ["a", "b", "c", "d", "e", "g", "x1", "x2", "x3"]);
  });

  it("enforces 20 groups per dish and 30 options per group", () => {
    const many = Array.from({ length: 21 }, (_, i) => group({ key: `g${i}` }));
    assert.match(checkAddons(many).formError ?? "", /at most 20/);
    assert.equal(checkAddons(many.slice(0, 20)).formError, null);

    const options = Array.from({ length: 31 }, (_, i) => ({ key: `o${i}`, name: `O${i}`, price: "0", sold_out: false }));
    assert.match(checkAddons([group({ options })]).errors.gk, /at most 30/);
    assert.deepEqual(checkAddons([group({ options: options.slice(0, 30) })]).errors, {});
  });

  it("is fine with no add-ons at all", () => {
    assert.deepEqual(checkAddons([]), { groups: [], errors: {}, formError: null });
  });
});

describe("addonWarnings and picksHint", () => {
  it("warns about an all-sold-out required group, too many picks and duplicate names", () => {
    const w = addonWarnings([
      group({ key: "a", required: true, options: [{ key: "1", name: "Mild", price: "", sold_out: true }] }),
      group({ key: "b", maxPicks: "5" }),
      group({ key: "c", options: [{ key: "2", name: "Egg", price: "", sold_out: false }, { key: "3", name: "egg ", price: "", sold_out: false }] }),
      group({ key: "d" }),
    ]);
    assert.match(w.a, /can't order this dish/);
    assert.match(w.b, /more than the 2 options/);
    assert.match(w.c, /same name/);
    assert.equal(w.d, undefined);
  });

  it("explains the picks rule", () => {
    assert.equal(picksHint(true, "1"), "Customers pick 1");
    assert.equal(picksHint(true, "3"), "Customers pick 1–3");
    assert.equal(picksHint(false, "2"), "Optional, up to 2");
  });
});

describe("drafts", () => {
  it("round-trips saved add-ons through the form unchanged", () => {
    const check = checkAddons(draftsFromSaved([SPICE, EXTRAS]));
    assert.ok(check.groups);
    assert.equal(addonsChanged([SPICE, EXTRAS], check.groups), false);
  });

  it("puts returned ids on new rows by position, skipping rows renamed meanwhile", () => {
    const drafts: GroupDraft[] = [
      group({ key: "a", name: "Spice level", options: [{ key: "x", name: "Mild", price: "", sold_out: false }, { key: "y", name: "Hotter", price: "", sold_out: false }] }),
    ];
    const out = draftsWithSavedIds(drafts, [SPICE]);
    assert.equal(out[0].id, "g1");
    assert.equal(out[0].options[0].id, "o1");
    assert.equal(out[0].options[1].id, undefined); // saved as "Hot", renamed "Hotter" meanwhile: left alone
  });

  it("sets sold out on the one option, in drafts and saved lists", () => {
    const saved = withSoldOut([SPICE, EXTRAS], "o3", true);
    assert.equal(saved[1].options[0].sold_out, true);
    assert.equal(saved[0], SPICE); // untouched groups keep their identity
    const drafts = withSoldOut(draftsFromSaved([SPICE]), "o2", true);
    assert.deepEqual(drafts[0].options.map((o) => o.sold_out), [false, true]);
  });
});

describe("addonsChanged", () => {
  const payload = () => checkAddons(draftsFromSaved([SPICE])).groups!;

  it("spots edits, reorders, additions and removals", () => {
    const renamed = payload();
    renamed[0].options[1].name = "Very hot";
    assert.equal(addonsChanged([SPICE], renamed), true);

    const reordered = payload();
    reordered[0].options.reverse();
    assert.equal(addonsChanged([SPICE], reordered), true);

    assert.equal(addonsChanged([SPICE], []), true);
    assert.equal(addonsChanged([], []), false);
    assert.equal(addonsChanged([SPICE], [...payload(), { name: "New", required: false, max_picks: 1, options: [] }]), true);
  });

  it("treats a price stored as 1.00 the same as 1", () => {
    assert.equal(addonsChanged([{ ...EXTRAS, options: [{ ...EXTRAS.options[0], price: Number("1.00") }] }], checkAddons(draftsFromSaved([EXTRAS])).groups!), false);
  });
});

describe("planAddonSaves", () => {
  const job = (key: string, id: string | undefined, groups = checkAddons(draftsFromSaved([SPICE])).groups!) => ({ key, id, name: key, groups });

  it("saves only dishes whose add-ons changed", () => {
    const changed = job("a", "a");
    changed.groups[0].name = "Spice";
    const { saves, unresolved } = planAddonSaves([changed, job("b", "b")], [], [], { a: [SPICE], b: [SPICE] });
    assert.deepEqual(saves.map((s) => s.menuItemId), ["a"]);
    assert.deepEqual(unresolved, []);
  });

  it("sends a new dish's add-ons under its new id, without old ids", () => {
    const fresh = { key: "k1", name: "Laksa", groups: [{ name: "Size", required: true, max_picks: 1, options: [{ name: "L", price: 1, sold_out: false }] }] };
    const stale = job("k2", "gone"); // id the menu no longer has: re-inserted
    const { saves } = planAddonSaves([fresh, stale], [{ key: "k1" }, { key: "k2" }], [{ id: "new1" }, { id: "new2" }], {});
    assert.deepEqual(saves.map((s) => s.menuItemId), ["new1", "new2"]);
    assert.equal(saves[1].groups[0].id, undefined);
    assert.equal(saves[1].groups[0].options[0].id, undefined);
  });

  it("skips new dishes without add-ons and reports unknown ids", () => {
    const empty = { key: "k1", name: "Teh", groups: [] };
    const withAddons = { key: "k2", name: "Laksa", groups: withoutIds(job("x", "x").groups) };
    // The insert returned fewer rows than sent: ids can't be matched up.
    const { saves, unresolved } = planAddonSaves([empty, withAddons], [{ key: "k1" }, { key: "k2" }], [{ id: "n1" }], {});
    assert.deepEqual(saves, []);
    assert.deepEqual(unresolved, ["Laksa"]);
  });

  it("saves an emptied list, so removing every group deletes them", () => {
    const { saves } = planAddonSaves([job("a", "a", [])], [], [], { a: [SPICE] });
    assert.deepEqual(saves, [{ key: "a", name: "a", menuItemId: "a", groups: [] }]);
  });
});

describe("parseSavedGroups", () => {
  it("reads the function's result and ignores junk", () => {
    assert.deepEqual(parseSavedGroups([{ ...SPICE, options: SPICE.options.map((o) => ({ ...o, price: String(o.price) })) }]), [SPICE]);
    assert.deepEqual(parseSavedGroups(null), []);
  });
});

describe("describeAddonsError", () => {
  it("says add-ons aren't ready when the function or grants are missing", () => {
    assert.equal(describeAddonsError({ code: "PGRST202", message: "Could not find the function" }), ADDONS_NOT_READY_MESSAGE);
    assert.equal(describeAddonsError({ code: "42883", message: "function does not exist" }), ADDONS_NOT_READY_MESSAGE);
    assert.equal(describeAddonsError({ code: "42501", message: "permission denied for function" }), ADDONS_NOT_READY_MESSAGE);
  });

  it("explains the function's own errors", () => {
    assert.match(describeAddonsError({ message: "option_not_for_item" }), /Reload/);
    assert.match(describeAddonsError({ message: "too_many_groups" }), /20/);
    assert.match(describeAddonsError({ message: "too_many_options" }), /30/);
    assert.match(describeAddonsError({ message: "options_invalid" }), /names, prices/);
    assert.match(describeAddonsError({ message: "something else" }), /Couldn't save add-ons: something else/);
  });
});

describe("describeSoldOutResult", () => {
  it("is fine when a row was updated", () => {
    assert.equal(describeSoldOutResult(null, [{ id: "o1" }]), null);
  });

  it("treats 0 rows as a failure", () => {
    assert.match(describeSoldOutResult(null, []) ?? "", /wasn't found/);
    assert.match(describeSoldOutResult(null, null) ?? "", /wasn't found/);
  });

  it("explains a missing grant and other errors", () => {
    assert.match(describeSoldOutResult({ code: "42501", message: "permission denied for table menu_options" }, null) ?? "", /can't be changed here yet/);
    assert.match(describeSoldOutResult({ message: "Failed to fetch" }, null) ?? "", /connection/);
  });
});

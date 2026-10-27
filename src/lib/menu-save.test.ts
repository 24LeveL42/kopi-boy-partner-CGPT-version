import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assignInsertedIds,
  dealsAffectedByRemoval,
  firstRowNeedingFix,
  planMenuSave,
  withInserted,
  withoutDeleted,
  withUpdates,
  type SavedMenuItem,
} from "./menu-save.ts";

const SAVED: SavedMenuItem[] = [
  { id: "a", name: "Chicken Rice", price: 5, photo_url: null },
  { id: "b", name: "Laksa", price: 7.5, photo_url: "https://x/laksa.jpg" },
  { id: "c", name: "Teh", price: 1.2, photo_url: null },
];

describe("planMenuSave", () => {
  it("writes nothing when nothing changed", () => {
    const plan = planMenuSave(SAVED, SAVED.map((i) => ({ id: i.id, name: i.name, price: i.price, photo_url: i.photo_url ?? "" })));
    assert.deepEqual(plan, { updates: [], inserts: [], deleteIds: [] });
  });

  it("updates changed rows in place, keeping their ids", () => {
    const plan = planMenuSave(SAVED, [
      { id: "a", name: "Chicken Rice", price: 5.5, photo_url: "" },
      { id: "b", name: "Laksa", price: 7.5, photo_url: "" }, // photo removed
      { id: "c", name: "Teh Tarik", price: 1.2, photo_url: "" },
    ]);
    assert.deepEqual(plan.updates, [
      { id: "a", name: "Chicken Rice", price: 5.5, photo_url: null },
      { id: "b", name: "Laksa", price: 7.5, photo_url: null },
      { id: "c", name: "Teh Tarik", price: 1.2, photo_url: null },
    ]);
    assert.deepEqual(plan.inserts, []);
    assert.deepEqual(plan.deleteIds, []);
  });

  it("inserts new rows and deletes only the removed ones", () => {
    const plan = planMenuSave(SAVED, [
      { id: "a", name: "Chicken Rice", price: 5, photo_url: "" },
      { name: "Milo", price: 2, photo_url: " https://x/milo.jpg " },
    ]);
    assert.deepEqual(plan.updates, []);
    assert.deepEqual(plan.inserts, [{ name: "Milo", price: 2, photo_url: "https://x/milo.jpg" }]);
    assert.deepEqual(plan.deleteIds, ["b", "c"]);
  });

  it("deletes a saved row the cook blanked out (it's dropped before planning, as before)", () => {
    const plan = planMenuSave(SAVED, [
      { id: "a", name: "Chicken Rice", price: 5, photo_url: "" },
      { id: "b", name: "Laksa", price: 7.5, photo_url: "https://x/laksa.jpg" },
    ]);
    assert.deepEqual(plan.deleteIds, ["c"]);
  });

  it("inserts everything on first-time setup", () => {
    const plan = planMenuSave([], [
      { name: "Chicken Rice", price: 5, photo_url: "" },
      { name: "Laksa", price: 7.5, photo_url: "" },
    ]);
    assert.equal(plan.inserts.length, 2);
    assert.deepEqual(plan.updates, []);
    assert.deepEqual(plan.deleteIds, []);
  });

  it("treats an id that isn't in the saved menu, or a repeated id, as a new row", () => {
    const plan = planMenuSave(SAVED.slice(0, 1), [
      { id: "a", name: "Chicken Rice", price: 5, photo_url: "" },
      { id: "a", name: "Chicken Rice (L)", price: 6, photo_url: "" },
      { id: "zzz", name: "Milo", price: 2, photo_url: "" },
    ]);
    assert.deepEqual(plan.updates, []);
    assert.deepEqual(plan.inserts.map((i) => i.name), ["Chicken Rice (L)", "Milo"]);
    assert.deepEqual(plan.deleteIds, []);
  });

  it("compares prices as numbers (Postgres numeric can arrive as text)", () => {
    const plan = planMenuSave([{ id: "a", name: "Rice", price: "5.00" as unknown as number, photo_url: null }], [{ id: "a", name: "Rice", price: 5, photo_url: "" }]);
    assert.deepEqual(plan.updates, []);
  });
});

describe("a second Save after a part-way failure", () => {
  // The form rows: two saved items, one removed (c), one new (k1).
  const rows = [
    { key: "a", id: "a", name: "Chicken Rice", price: 5, photo_url: "" },
    { key: "b", id: "b", name: "Laksa", price: 8, photo_url: "https://x/laksa.jpg" }, // price changed
    { key: "k1", name: "Milo", price: 2, photo_url: "" },
  ];

  it("updates the rows the first Save inserted instead of inserting them again", () => {
    const first = planMenuSave(SAVED, rows);
    assert.deepEqual(first.inserts, [{ key: "k1", name: "Milo", price: 2, photo_url: null }]);
    assert.deepEqual(first.updates.map((u) => u.id), ["b"]);
    assert.deepEqual(first.deleteIds, ["c"]);

    // Updates and the insert succeed (insert ... select id returns "n1"), then the delete fails.
    let saved = withUpdates(SAVED, first.updates);
    const inserted = [{ id: "n1", name: "Milo", price: 2, photo_url: null }];
    saved = withInserted(saved, inserted);
    const rowsAfter = assignInsertedIds(rows, first.inserts, inserted);
    assert.equal(rowsAfter[2].id, "n1");
    assert.equal(rowsAfter[0].id, "a"); // untouched rows keep their ids

    const second = planMenuSave(saved, rowsAfter);
    assert.deepEqual(second.inserts, []); // no duplicate Milo
    assert.deepEqual(second.updates, []); // Laksa's new price is already saved
    assert.deepEqual(second.deleteIds, ["c"]); // only the step that failed is left

    // Once the delete succeeds too, a third Save has nothing to do.
    saved = withoutDeleted(saved, second.deleteIds);
    assert.deepEqual(planMenuSave(saved, rowsAfter), { updates: [], inserts: [], deleteIds: [] });
  });

  it("matches inserted ids to rows by insert order, and leaves rows alone when nothing came back", () => {
    const two: { key: string; id?: string; name: string; price: number; photo_url: string }[] = [
      { key: "k1", name: "Milo", price: 2, photo_url: "" },
      { key: "k2", name: "Kopi", price: 1.8, photo_url: "" },
    ];
    const plan = planMenuSave([], two);
    assert.deepEqual(assignInsertedIds(two, plan.inserts, [{ id: "n1" }, { id: "n2" }]).map((r) => r.id), ["n1", "n2"]);
    assert.deepEqual(assignInsertedIds(two, plan.inserts, []).map((r) => r.id), [undefined, undefined]);
  });

  it("never sends the form's row key as a column", () => {
    const [insert] = planMenuSave([], [{ key: "k1", name: "Milo", price: 2, photo_url: "" }]).inserts;
    const { name, price, photo_url } = insert;
    assert.deepEqual({ name, price, photo_url }, { name: "Milo", price: 2, photo_url: null });
    assert.equal(insert.key, "k1"); // the form strips it: KitchenSetupForm inserts name, price, photo_url only
  });
});

describe("dealsAffectedByRemoval", () => {
  const deals = [
    { id: "d1", title: "Rice deal", free_item_id: null, item_ids: ["a"] },
    { id: "d2", title: "Two dishes", free_item_id: null, item_ids: ["a", "b"] },
    { id: "d3", title: "Free teh", free_item_id: "c", item_ids: [] },
    { id: "d4", title: "Whole menu", free_item_id: null, item_ids: [] },
  ];

  it("ignores deals that don't use the removed items", () => {
    assert.deepEqual(dealsAffectedByRemoval(deals, ["zzz"]), []);
    assert.deepEqual(dealsAffectedByRemoval(deals, []), []);
  });

  it("marks taking a deal's last eligible item as critical", () => {
    const [d1, d2] = dealsAffectedByRemoval(deals, ["a"]);
    assert.equal(d1.id, "d1");
    assert.equal(d1.losesLastItem, true);
    assert.equal(d1.critical, true);
    assert.equal(d2.id, "d2");
    assert.deepEqual(d2.removedItemIds, ["a"]);
    assert.equal(d2.losesLastItem, false);
    assert.equal(d2.critical, false);
  });

  it("marks taking a deal's free item as critical", () => {
    const [d3] = dealsAffectedByRemoval(deals, ["c"]);
    assert.equal(d3.id, "d3");
    assert.equal(d3.losesFreeItem, true);
    assert.equal(d3.removedFreeItemId, "c");
    assert.equal(d3.critical, true);
  });

  it("marks a deal critical once all its items go, even across several", () => {
    const affected = dealsAffectedByRemoval(deals, ["a", "b"]);
    assert.deepEqual(affected.map((a) => [a.id, a.critical]), [["d1", true], ["d2", true]]);
  });
});

describe("firstRowNeedingFix", () => {
  const rows = [
    { key: "a", id: "a", hasAddons: false },
    { key: "b", id: "b", hasAddons: false },
    { key: "n1", hasAddons: false },
    { key: "n2", hasAddons: true },
  ];

  it("passes when every saved dish still has a name and price", () => {
    assert.equal(firstRowNeedingFix(rows, new Set(["a", "b", "n2"]), SAVED), -1); // blank new row n1 is just dropped
  });

  it("stops a saved dish with a blank price from being deleted", () => {
    assert.equal(firstRowNeedingFix(rows, new Set(["a", "n2"]), SAVED), 1);
  });

  it("stops a new dish with add-ons from being dropped", () => {
    assert.equal(firstRowNeedingFix(rows, new Set(["a", "b"]), SAVED), 3);
  });

  it("lets a row whose id is no longer saved be dropped like a new one", () => {
    assert.equal(firstRowNeedingFix([{ key: "z", id: "gone", hasAddons: false }], new Set(), SAVED), -1);
  });
});

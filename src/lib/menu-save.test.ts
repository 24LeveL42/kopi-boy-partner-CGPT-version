import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dealsAffectedByRemoval, planMenuSave, type SavedMenuItem } from "./menu-save.ts";

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

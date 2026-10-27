import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isOrderOptionsUnavailable, orderLine } from "./order-lines.ts";

describe("orderLine", () => {
  it("shows a line without add-ons as before", () => {
    assert.deepEqual(orderLine({ name: "Chicken Rice", price: 5, quantity: 1 }), { label: "Chicken Rice x1", options: "", total: 5 });
    assert.deepEqual(orderLine({ name: "Teh", price: "1.20", quantity: 3, options_price: null, order_item_options: [] }), {
      label: "Teh x3",
      options: "",
      total: 3.6,
    });
  });

  it("adds the per-unit add-on total before multiplying by quantity", () => {
    const line = orderLine({
      name: "Laksa",
      price: "7.50",
      quantity: 2,
      options_price: "1.00",
      order_item_options: [
        { name: "Extra egg", sort_order: 1 },
        { name: "Hot", sort_order: 0 },
      ],
    });
    assert.deepEqual(line, { label: "Laksa x2", options: "Hot, Extra egg", total: 17 });
  });

  it("keeps the total right when the add-on names couldn't be loaded", () => {
    assert.equal(orderLine({ name: "Laksa", price: 7.5, quantity: 2, options_price: 1 }).total, 17);
  });

  it("rounds to cents", () => {
    assert.equal(orderLine({ name: "Kopi", price: 1.1, quantity: 3, options_price: 0.2 }).total, 3.9);
  });

  it("treats a junk options_price as no add-ons", () => {
    assert.equal(orderLine({ name: "Kopi", price: 2, quantity: 1, options_price: "abc" }).total, 2);
  });
});

describe("isOrderOptionsUnavailable", () => {
  it("spots a missing grant or relationship for order_item_options", () => {
    assert.equal(isOrderOptionsUnavailable({ code: "42501", message: "permission denied for table order_item_options" }), true);
    assert.equal(isOrderOptionsUnavailable({ code: "PGRST200", message: "Could not find a relationship" }), true);
    assert.equal(isOrderOptionsUnavailable({ message: "column order_item_options.sort_order does not exist" }), true);
  });

  it("leaves other errors alone", () => {
    assert.equal(isOrderOptionsUnavailable(null), false);
    assert.equal(isOrderOptionsUnavailable({ message: "column orders.cook_hidden_at does not exist" }), false);
  });
});

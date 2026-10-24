import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { orderDeliveryFee, orderDiscount, orderFoodTotal, orderTotal } from "./order-amounts.ts";

describe("order amounts", () => {
  it("uses food_total and adds the delivery fee", () => {
    const order = { subtotal: 20, discount_total: 4, food_total: 16, delivery_fee_estimate: 3.5 };
    assert.equal(orderFoodTotal(order), 16);
    assert.equal(orderDiscount(order), 4);
    assert.equal(orderTotal(order), 19.5);
  });

  it("falls back to subtotal when food_total is missing or null", () => {
    assert.equal(orderFoodTotal({ subtotal: 12 }), 12);
    assert.equal(orderFoodTotal({ subtotal: 12, food_total: null }), 12);
    assert.equal(orderTotal({ subtotal: 12, food_total: null, delivery_fee_estimate: 2 }), 14);
  });

  it("has no deal line without a discount", () => {
    assert.equal(orderDiscount({ subtotal: 12 }), 0);
    assert.equal(orderDiscount({ subtotal: 12, discount_total: 0 }), 0);
    assert.equal(orderDiscount({ subtotal: 12, discount_total: null }), 0);
  });

  it("reads numeric columns sent as text and rounds to cents", () => {
    const order = { subtotal: "10.10", discount_total: "1.01", food_total: "9.09", delivery_fee_estimate: "0.2" };
    assert.equal(orderFoodTotal(order), 9.09);
    assert.equal(orderDiscount(order), 1.01);
    assert.equal(orderTotal(order), 9.29);
  });

  it("treats a missing delivery fee as zero", () => {
    assert.equal(orderDeliveryFee({ subtotal: 5 }), 0);
    assert.equal(orderDeliveryFee({ subtotal: 5, delivery_fee_estimate: null }), 0);
    assert.equal(orderTotal({ subtotal: 5, food_total: 5 }), 5);
  });
});

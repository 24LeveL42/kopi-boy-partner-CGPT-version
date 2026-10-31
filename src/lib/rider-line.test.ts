import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickLineTarget, riderMapProps } from "./rider-line.ts";

describe("pickLineTarget", () => {
  const dropoff = { lat: 1.3521, lng: 103.8198 };

  it("has no line before pickup", () => {
    assert.equal(pickLineTarget(false, dropoff), null);
  });

  it("points at the customer's drop-off after pickup", () => {
    assert.deepEqual(pickLineTarget(true, dropoff), [1.3521, 103.8198]);
  });

  it("accepts numeric strings (Postgres numeric)", () => {
    assert.deepEqual(pickLineTarget(true, { lat: "1.352100", lng: "103.819800" }), [1.3521, 103.8198]);
  });

  const bad: [string, unknown][] = [
    ["no dropoff", null],
    ["undefined dropoff", undefined],
    ["null lat", { lat: null, lng: 103.8 }],
    ["missing lng", { lat: 1.35, lng: undefined }],
    ["empty string", { lat: "", lng: "" }],
    ["not a number", { lat: "abc", lng: 103.8 }],
    ["out of range", { lat: 91, lng: 103.8 }],
    ["0,0", { lat: 0, lng: 0 }],
  ];
  for (const [label, d] of bad) {
    it(`has no line when coordinates are missing or bad: ${label}`, () => {
      assert.equal(pickLineTarget(true, d as never), null);
    });
  }
});

describe("riderMapProps (cook's order card → RiderLocationMap)", () => {
  // latitude/longitude and kitchen_* stand in for a leak: they must never reach the map.
  const order = {
    customer_lat: "1.352100",
    customer_lng: "103.819800",
    latitude: 1.4444,
    longitude: 103.7777,
    kitchen_lat: 1.4444,
    kitchen_lng: 103.7777,
    kitchens: { latitude: 1.4444, longitude: 103.7777 },
  };
  const accepted = { id: "dr-1", picked_up_at: null };
  const pickedUp = { id: "dr-1", picked_up_at: "2026-10-31T10:32:00Z" };

  it("passes no drop-off before pickup, even with saved coordinates", () => {
    assert.deepEqual(riderMapProps(order, accepted), { deliveryRequestId: "dr-1", dropoff: null });
  });

  it("passes the customer's drop-off after pickup", () => {
    assert.deepEqual(riderMapProps(order, pickedUp), { deliveryRequestId: "dr-1", dropoff: [1.3521, 103.8198] });
  });

  it("passes no drop-off after pickup on an older order without coordinates", () => {
    assert.equal(riderMapProps({ customer_lat: null, customer_lng: null }, pickedUp).dropoff, null);
    assert.equal(riderMapProps({}, pickedUp).dropoff, null);
  });

  it("never passes kitchen coordinates to the map", () => {
    for (const request of [accepted, pickedUp]) {
      const props = riderMapProps(order, request);
      assert.deepEqual(Object.keys(props).sort(), ["deliveryRequestId", "dropoff"]);
      const raw = JSON.stringify(props);
      assert.ok(!raw.includes("1.4444") && !raw.includes("103.7777"), raw);
    }
    // Even with no customer coordinates, nothing falls back to the kitchen's.
    assert.equal(riderMapProps({ ...order, customer_lat: null, customer_lng: null }, pickedUp).dropoff, null);
  });
});

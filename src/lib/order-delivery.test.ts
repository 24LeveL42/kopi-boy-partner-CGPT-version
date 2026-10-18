import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ASAP_LABEL,
  deliveryDestination,
  formatScheduledFor,
  isExpress,
  loadDeliveryOrderDetails,
} from "./order-delivery.ts";

describe("formatScheduledFor", () => {
  it("shows a scheduled order in Singapore time", () => {
    // 10:30 UTC = 6:30 pm in Singapore (UTC+8), whatever zone the test runs in.
    assert.equal(formatScheduledFor("2026-10-19T10:30:00Z"), "Requested for Mon 19 Oct, 6:30 pm");
  });

  it("rolls over to the Singapore date and keeps morning times as am", () => {
    // 23:05 UTC Sunday = 7:05 am Monday in Singapore.
    assert.equal(formatScheduledFor("2026-10-18T23:05:00Z"), "Requested for Mon 19 Oct, 7:05 am");
  });

  it("says As soon as possible when there's no scheduled time (incl. old orders)", () => {
    assert.equal(formatScheduledFor(null), ASAP_LABEL);
    assert.equal(formatScheduledFor(undefined), ASAP_LABEL);
    assert.equal(formatScheduledFor(""), ASAP_LABEL);
    assert.equal(ASAP_LABEL, "As soon as possible");
  });

  it("doesn't claim ASAP for a value it can't read", () => {
    assert.equal(formatScheduledFor("not a date"), "Requested time unavailable");
  });
});

describe("isExpress", () => {
  it("is true only for express", () => {
    assert.equal(isExpress({ delivery_type: "express" }), true);
    assert.equal(isExpress({ delivery_type: "normal" }), false);
    assert.equal(isExpress({ delivery_type: null }), false);
    assert.equal(isExpress({}), false);
  });
});

describe("deliveryDestination", () => {
  it("shows the address line, unit and notes from the new fields", () => {
    assert.deepEqual(
      deliveryDestination({
        delivery_address_line: "123 Lorong 1 Toa Payoh Singapore 310123",
        delivery_unit: "#05-12",
        delivery_notes: "Leave at door",
        customer_postal_code: "310123",
      }),
      { address: "123 Lorong 1 Toa Payoh Singapore 310123", unit: "#05-12", notes: "Leave at door" }
    );
  });

  it("falls back to the postal code for an old order without the address fields", () => {
    assert.deepEqual(deliveryDestination({ customer_postal_code: "310123" }), {
      address: "Singapore 310123",
      unit: null,
      notes: null,
    });
  });

  it("shows only the postal sector on an open rider job", () => {
    assert.deepEqual(deliveryDestination({ customer_postal_sector: "31", delivery_type: "express" }), {
      address: "Postal sector 31",
      unit: null,
      notes: null,
    });
  });

  it("still renders an order with none of the fields", () => {
    assert.deepEqual(deliveryDestination({}), { address: "No delivery address on this order", unit: null, notes: null });
  });

  it("treats blank strings as missing", () => {
    assert.deepEqual(
      deliveryDestination({ delivery_address_line: "  ", delivery_unit: "", delivery_notes: " ", customer_postal_code: "310123" }),
      { address: "Singapore 310123", unit: null, notes: null }
    );
  });
});

describe("loadDeliveryOrderDetails", () => {
  function fakeClient(result: { data?: unknown; error?: { message: string } | null; throws?: boolean }) {
    const calls: { fn: string; args: unknown }[] = [];
    const client = {
      rpc(fn: string, args: unknown) {
        calls.push({ fn, args });
        if (result.throws) throw new Error("network down");
        return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
      },
    };
    return { client: client as unknown as Parameters<typeof loadDeliveryOrderDetails>[0], calls };
  }

  it("asks for every request in one call and keys the rows by request id", async () => {
    const { client, calls } = fakeClient({
      data: [
        { delivery_request_id: "req-1", delivery_type: "express", scheduled_for: null, customer_postal_sector: "31" },
        { delivery_request_id: "req-2", delivery_type: "normal", scheduled_for: "2026-10-19T10:30:00Z", delivery_notes: "Leave at door" },
      ],
    });
    const result = await loadDeliveryOrderDetails(client, ["req-1", "req-2"]);
    assert.deepEqual(calls, [{ fn: "get_delivery_order_details", args: { p_delivery_request_ids: ["req-1", "req-2"] } }]);
    assert.deepEqual(result, {
      "req-1": { delivery_type: "express", scheduled_for: null, customer_postal_sector: "31" },
      "req-2": { delivery_type: "normal", scheduled_for: "2026-10-19T10:30:00Z", delivery_notes: "Leave at door" },
    });
  });

  it("skips the call when there are no requests", async () => {
    const { client, calls } = fakeClient({ data: [] });
    assert.deepEqual(await loadDeliveryOrderDetails(client, []), {});
    assert.equal(calls.length, 0);
  });

  it("returns null when the function is missing or errors, so cards hide the section", async () => {
    const { client } = fakeClient({ error: { message: "function public.get_delivery_order_details does not exist" } });
    assert.equal(await loadDeliveryOrderDetails(client, ["req-1"]), null);
  });

  it("returns null instead of throwing when the client throws", async () => {
    const { client } = fakeClient({ throws: true });
    assert.equal(await loadDeliveryOrderDetails(client, ["req-1"]), null);
  });
});

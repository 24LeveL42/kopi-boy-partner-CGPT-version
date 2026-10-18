import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RIDER_REQUEST_LEAD_MINUTES,
  canRequestRiderAt,
  requestRiderAs,
  riderRequestOpensAt,
  riderRequestOpensLabel,
} from "./rider-request.ts";

// 10:15 UTC = 6:15 pm Singapore, so the window opens at 5:30 pm.
const SCHEDULED = "2026-10-19T10:15:00Z";
const at = (iso: string) => new Date(iso).getTime();
const minutesBefore = (minutes: number) => at(SCHEDULED) - minutes * 60_000;

describe("canRequestRiderAt", () => {
  it("blocks a scheduled order that is far away", () => {
    assert.equal(canRequestRiderAt(SCHEDULED, minutesBefore(24 * 60)), false);
    assert.equal(canRequestRiderAt(SCHEDULED, minutesBefore(46)), false);
  });

  it("allows a scheduled order within 45 minutes", () => {
    assert.equal(canRequestRiderAt(SCHEDULED, minutesBefore(30)), true);
    assert.equal(canRequestRiderAt(SCHEDULED, minutesBefore(0)), true);
    assert.equal(canRequestRiderAt(SCHEDULED, minutesBefore(-10)), true); // already past its time
  });

  it("allows a scheduled order exactly 45 minutes away", () => {
    assert.equal(RIDER_REQUEST_LEAD_MINUTES, 45);
    assert.equal(canRequestRiderAt(SCHEDULED, minutesBefore(45)), true);
    assert.equal(canRequestRiderAt(SCHEDULED, minutesBefore(45) - 1), false); // 1 ms earlier
  });

  it("allows an ASAP order any time", () => {
    assert.equal(canRequestRiderAt(null, Date.now()), true);
    assert.equal(canRequestRiderAt(undefined, Date.now()), true);
    assert.equal(canRequestRiderAt("", Date.now()), true);
    assert.equal(riderRequestOpensAt(null), null);
  });
});

describe("riderRequestOpensLabel", () => {
  it("shows when the window opens, in Singapore time", () => {
    assert.equal(riderRequestOpensLabel(SCHEDULED), "Rider can be requested from 5:30 pm");
    // 00:30 UTC = 8:30 am Singapore → opens 7:45 am.
    assert.equal(riderRequestOpensLabel("2026-10-19T00:30:00Z"), "Rider can be requested from 7:45 am");
  });

  it("is empty for an ASAP order", () => {
    assert.equal(riderRequestOpensLabel(null), "");
  });
});

/** Just enough of the Supabase client: the orders lookup and the delivery_requests insert. */
function fakeClient({
  order = { scheduled_for: null } as { scheduled_for?: string | null } | null,
  orderError = null as { message: string } | null,
  insertError = null as { message: string } | null,
} = {}) {
  const inserts: unknown[] = [];
  const filters: [string, unknown][] = [];
  const client = {
    from(table: string) {
      if (table === "orders") {
        const q = {
          select: () => q,
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            return q;
          },
          maybeSingle: async () => ({ data: order, error: orderError }),
        };
        return q;
      }
      return {
        insert: async (row: unknown) => {
          inserts.push({ table, row });
          return { error: insertError };
        },
      };
    },
  };
  return { client: client as unknown as Parameters<typeof requestRiderAs>[0], inserts, filters };
}

describe("requestRiderAs", () => {
  it("refuses a scheduled order that is far away and never inserts", async () => {
    const { client, inserts } = fakeClient({ order: { scheduled_for: SCHEDULED } });
    const result = await requestRiderAs(client, "kitchen-1", "order-1", minutesBefore(3 * 60));
    assert.deepEqual(result, { ok: false, error: "Rider can be requested from 5:30 pm." });
    assert.equal(inserts.length, 0);
  });

  it("requests a rider for a scheduled order within 45 minutes", async () => {
    const { client, inserts, filters } = fakeClient({ order: { scheduled_for: SCHEDULED } });
    assert.deepEqual(await requestRiderAs(client, "kitchen-1", "order-1", minutesBefore(20)), { ok: true });
    assert.deepEqual(inserts, [{ table: "delivery_requests", row: { order_id: "order-1", kitchen_id: "kitchen-1" } }]);
    assert.deepEqual(filters, [
      ["id", "order-1"],
      ["kitchen_id", "kitchen-1"],
    ]);
  });

  it("requests a rider exactly 45 minutes before", async () => {
    const { client, inserts } = fakeClient({ order: { scheduled_for: SCHEDULED } });
    assert.deepEqual(await requestRiderAs(client, "kitchen-1", "order-1", minutesBefore(45)), { ok: true });
    assert.equal(inserts.length, 1);
  });

  it("requests a rider for an ASAP order, including an old order without the column", async () => {
    for (const order of [{ scheduled_for: null }, {}]) {
      const { client, inserts } = fakeClient({ order });
      assert.deepEqual(await requestRiderAs(client, "kitchen-1", "order-1", Date.now()), { ok: true });
      assert.equal(inserts.length, 1);
    }
  });

  it("passes the database's refusal through (e.g. the trigger, on its own clock)", async () => {
    const { client } = fakeClient({ insertError: { message: "Rider can be requested from 5:30 pm." } });
    assert.deepEqual(await requestRiderAs(client, "kitchen-1", "order-1", Date.now()), {
      ok: false,
      error: "Rider can be requested from 5:30 pm.",
    });
  });

  it("refuses an order that isn't the cook's, or can't be loaded", async () => {
    const missing = fakeClient({ order: null });
    assert.equal((await requestRiderAs(missing.client, "kitchen-1", "order-1", Date.now())).ok, false);
    assert.equal(missing.inserts.length, 0);

    const failing = fakeClient({ order: null, orderError: { message: "boom" } });
    assert.equal((await requestRiderAs(failing.client, "kitchen-1", "order-1", Date.now())).ok, false);
    assert.equal(failing.inserts.length, 0);
  });

  it("refuses an empty order id", async () => {
    const { client, inserts } = fakeClient();
    assert.equal((await requestRiderAs(client, "kitchen-1", "", Date.now())).ok, false);
    assert.equal(inserts.length, 0);
  });
});

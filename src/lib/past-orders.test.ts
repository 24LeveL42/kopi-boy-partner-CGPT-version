import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cookOrderFinishedAt,
  cookOrderOutcome,
  formatFinishedAt,
  hideAllCookOrdersAs,
  hideAllRiderJobsAs,
  hideCookOrderAs,
  hideRiderJobAs,
  isCookOrderFinished,
  isMissingHiddenColumn,
  isRiderJobFinished,
  newestFirst,
  riderJobFinishedAt,
  riderJobOutcome,
  BLOCKED_ACCOUNT_MESSAGE,
  COOK_NOT_FINISHED_MESSAGE,
  NOT_SET_UP_MESSAGE,
  RIDER_NOT_FINISHED_MESSAGE,
} from "./past-orders.ts";

const PLACED_AT = "2026-10-19T02:00:00Z";
const DELIVERED_AT = "2026-10-19T03:00:00Z";

function order(overrides: Record<string, unknown> = {}) {
  return {
    order_status: "accepted",
    payment_status: "paid",
    decided_at: null as string | null,
    created_at: PLACED_AT,
    delivery_requests: [{ status: "completed", completed_at: DELIVERED_AT }] as { status: string; completed_at?: string | null }[],
    ...overrides,
  };
}

describe("isCookOrderFinished", () => {
  it("is true for cancelled and rejected orders", () => {
    assert.equal(isCookOrderFinished(order({ order_status: "cancelled", delivery_requests: [] })), true);
    assert.equal(isCookOrderFinished(order({ order_status: "rejected", payment_status: "unpaid", delivery_requests: [] })), true);
  });

  it("is true for a delivered, paid order", () => {
    assert.equal(isCookOrderFinished(order()), true);
  });

  it("keeps active orders active: placed, cooking, ready, waiting for or with a rider", () => {
    assert.equal(isCookOrderFinished(order({ order_status: "placed", payment_status: "unpaid", delivery_requests: [] })), false);
    assert.equal(isCookOrderFinished(order({ delivery_requests: [] })), false);
    assert.equal(isCookOrderFinished(order({ delivery_requests: null })), false);
    assert.equal(isCookOrderFinished(order({ delivery_requests: [{ status: "open" }] })), false);
    assert.equal(isCookOrderFinished(order({ delivery_requests: [{ status: "accepted" }] })), false);
    assert.equal(isCookOrderFinished(order({ delivery_requests: [{ status: "cancelled" }] })), false);
  });

  it("keeps a delivered order the cook hasn't marked paid active, so they can still mark it", () => {
    assert.equal(isCookOrderFinished(order({ payment_status: "unpaid" })), false);
  });
});

describe("isRiderJobFinished", () => {
  it("is true only for completed and cancelled jobs", () => {
    assert.equal(isRiderJobFinished({ status: "completed" }), true);
    assert.equal(isRiderJobFinished({ status: "cancelled" }), true);
    for (const status of ["open", "accepted", "release_requested"]) assert.equal(isRiderJobFinished({ status }), false);
  });
});

describe("outcomes and finished times", () => {
  it("labels each outcome", () => {
    assert.equal(cookOrderOutcome(order()), "Delivered");
    assert.equal(cookOrderOutcome(order({ order_status: "cancelled" })), "Cancelled");
    assert.equal(cookOrderOutcome(order({ order_status: "rejected" })), "Rejected");
    assert.equal(riderJobOutcome({ status: "completed" }), "Delivered");
    assert.equal(riderJobOutcome({ status: "cancelled" }), "Cancelled");
  });

  it("uses the delivered time, the rejection time, else when it was placed", () => {
    assert.equal(cookOrderFinishedAt(order()), DELIVERED_AT);
    assert.equal(cookOrderFinishedAt(order({ order_status: "rejected", decided_at: "2026-10-19T02:05:00Z", delivery_requests: [] })), "2026-10-19T02:05:00Z");
    assert.equal(cookOrderFinishedAt(order({ order_status: "cancelled", delivery_requests: [] })), PLACED_AT);
    assert.equal(riderJobFinishedAt({ status: "completed", completed_at: DELIVERED_AT, accepted_at: PLACED_AT, created_at: PLACED_AT }), DELIVERED_AT);
    assert.equal(riderJobFinishedAt({ status: "cancelled", completed_at: null, accepted_at: null, created_at: PLACED_AT }), PLACED_AT);
  });

  it("sorts newest first without changing the input", () => {
    const items = [{ at: "2026-10-17T00:00:00Z" }, { at: "2026-10-19T00:00:00Z" }, { at: "2026-10-18T00:00:00Z" }];
    const sorted = newestFirst(items, (i) => i.at);
    assert.deepEqual(sorted.map((i) => i.at), ["2026-10-19T00:00:00Z", "2026-10-18T00:00:00Z", "2026-10-17T00:00:00Z"]);
    assert.equal(items[0].at, "2026-10-17T00:00:00Z");
  });

  it("formats in Singapore time", () => {
    assert.equal(formatFinishedAt("2026-10-19T10:12:00Z"), "19 Oct, 6:12 pm");
    assert.equal(formatFinishedAt("not a date"), "");
  });
});

describe("isMissingHiddenColumn", () => {
  it("spots the missing-column error only", () => {
    assert.equal(isMissingHiddenColumn({ message: "column orders.cook_hidden_at does not exist" }, "cook_hidden_at"), true);
    assert.equal(isMissingHiddenColumn({ message: "permission denied for table orders" }, "cook_hidden_at"), false);
    assert.equal(isMissingHiddenColumn(null, "cook_hidden_at"), false);
  });
});

// ---------------------------------------------------------------------------
// Fake Supabase client: profiles + one row lookup + rpc. Records every rpc so
// tests can assert a refused call never reaches the database.
// ---------------------------------------------------------------------------

type Profile = { role: string; is_active: boolean } | null;
type DbError = { code?: string; message: string } | null;

function fakeClient({
  profile = { role: "cook", is_active: true } as Profile,
  profileError = null as DbError,
  row = null as unknown,
  rowError = null as DbError,
  rpcError = null as DbError,
  throwOnRpc = false,
} = {}) {
  const rpcs: { fn: string; args: unknown }[] = [];
  const lookups: { table: string; filters: [string, unknown][] }[] = [];
  const client = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      if (table !== "profiles") lookups.push({ table, filters });
      const q = {
        select: () => q,
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return q;
        },
        maybeSingle: async () => (table === "profiles" ? { data: profile, error: profileError } : { data: row, error: rowError }),
      };
      return q;
    },
    async rpc(fn: string, args: unknown) {
      if (throwOnRpc) throw new Error("network down");
      rpcs.push({ fn, args });
      return { error: rpcError };
    },
  };
  return { client: client as unknown as Parameters<typeof hideCookOrderAs>[0], rpcs, lookups };
}

const BLOCKED = { ok: false, error: BLOCKED_ACCOUNT_MESSAGE, blocked: true };
const RIDER = { role: "rider", is_active: true };

describe("hideCookOrderAs", () => {
  it("hides a finished order at the cook's own kitchen through the database function", async () => {
    const { client, rpcs, lookups } = fakeClient({ row: order() });
    assert.deepEqual(await hideCookOrderAs(client, "cook-1", "order-1"), { ok: true });
    assert.deepEqual(rpcs, [{ fn: "hide_cook_order", args: { p_order_id: "order-1" } }]);
    // The lookup is scoped to the session's kitchen, not just the id.
    assert.deepEqual(lookups[0].filters, [
      ["id", "order-1"],
      ["kitchen_id", "cook-1"],
    ]);
  });

  it("refuses an active order and never calls the database function", async () => {
    for (const row of [order({ order_status: "placed", delivery_requests: [] }), order({ delivery_requests: [{ status: "accepted" }] })]) {
      const { client, rpcs } = fakeClient({ row });
      assert.deepEqual(await hideCookOrderAs(client, "cook-1", "order-1"), { ok: false, error: COOK_NOT_FINISHED_MESSAGE });
      assert.equal(rpcs.length, 0);
    }
  });

  it("refuses another kitchen's order (not visible to this cook)", async () => {
    const { client, rpcs } = fakeClient({ row: null });
    assert.deepEqual(await hideCookOrderAs(client, "cook-1", "order-1"), { ok: false, error: "This order isn't at your kitchen." });
    assert.equal(rpcs.length, 0);
  });

  it("refuses a blocked cook with the blocked result and never writes", async () => {
    const { client, rpcs } = fakeClient({ profile: { role: "cook", is_active: false }, row: order() });
    assert.deepEqual(await hideCookOrderAs(client, "cook-1", "order-1"), BLOCKED);
    assert.equal(rpcs.length, 0);
  });

  it("refuses a rider using the cook action", async () => {
    const { client, rpcs } = fakeClient({ profile: RIDER, row: order() });
    assert.deepEqual(await hideCookOrderAs(client, "rider-1", "order-1"), { ok: false, error: "Only cooks can do this." });
    assert.equal(rpcs.length, 0);
  });

  it("refuses an empty id, a failed profile check and a failed lookup", async () => {
    const empty = fakeClient({ row: order() });
    assert.equal((await hideCookOrderAs(empty.client, "cook-1", "")).ok, false);
    const noProfile = fakeClient({ profile: null, profileError: { message: "boom" } });
    assert.equal((await hideCookOrderAs(noProfile.client, "cook-1", "order-1")).ok, false);
    const noRow = fakeClient({ rowError: { message: "boom" } });
    assert.equal((await hideCookOrderAs(noRow.client, "cook-1", "order-1")).ok, false);
    assert.equal(empty.rpcs.length + noProfile.rpcs.length + noRow.rpcs.length, 0);
  });

  it("passes the database's refusals through, mapping a block mid-request", async () => {
    const blocked = fakeClient({ row: order(), rpcError: { message: "Your account is blocked." } });
    assert.deepEqual(await hideCookOrderAs(blocked.client, "cook-1", "order-1"), BLOCKED);
    const refused = fakeClient({ row: order(), rpcError: { message: "Only finished orders can be removed from your list." } });
    assert.deepEqual(await hideCookOrderAs(refused.client, "cook-1", "order-1"), { ok: false, error: COOK_NOT_FINISHED_MESSAGE });
  });

  it("explains when the SQL hasn't been run yet", async () => {
    const { client } = fakeClient({ row: order(), rpcError: { code: "PGRST202", message: "Could not find the function" } });
    assert.deepEqual(await hideCookOrderAs(client, "cook-1", "order-1"), { ok: false, error: NOT_SET_UP_MESSAGE });
  });

  it("returns a result instead of throwing", async () => {
    const { client } = fakeClient({ row: order(), throwOnRpc: true });
    assert.equal((await hideCookOrderAs(client, "cook-1", "order-1")).ok, false);
  });
});

describe("hideAllCookOrdersAs", () => {
  it("lets the database pick the finished orders (no ids from the browser)", async () => {
    const { client, rpcs } = fakeClient();
    assert.deepEqual(await hideAllCookOrdersAs(client, "cook-1"), { ok: true });
    assert.deepEqual(rpcs, [{ fn: "hide_all_cook_past_orders", args: undefined }]);
  });

  it("refuses a blocked cook and a non-cook", async () => {
    const blocked = fakeClient({ profile: { role: "cook", is_active: false } });
    assert.deepEqual(await hideAllCookOrdersAs(blocked.client, "cook-1"), BLOCKED);
    const rider = fakeClient({ profile: RIDER });
    assert.equal((await hideAllCookOrdersAs(rider.client, "rider-1")).ok, false);
    assert.equal(blocked.rpcs.length + rider.rpcs.length, 0);
  });
});

describe("hideRiderJobAs", () => {
  const job = (overrides: Record<string, unknown> = {}) => ({ rider_id: "rider-1", status: "completed", ...overrides });

  it("hides the rider's own finished job through the database function", async () => {
    for (const status of ["completed", "cancelled"]) {
      const { client, rpcs } = fakeClient({ profile: RIDER, row: job({ status }) });
      assert.deepEqual(await hideRiderJobAs(client, "rider-1", "req-1"), { ok: true });
      assert.deepEqual(rpcs, [{ fn: "hide_rider_job", args: { p_request_id: "req-1" } }]);
    }
  });

  it("refuses an active job", async () => {
    for (const status of ["open", "accepted", "release_requested"]) {
      const { client, rpcs } = fakeClient({ profile: RIDER, row: job({ status }) });
      assert.deepEqual(await hideRiderJobAs(client, "rider-1", "req-1"), { ok: false, error: RIDER_NOT_FINISHED_MESSAGE });
      assert.equal(rpcs.length, 0);
    }
  });

  it("refuses another rider's job, or one it can't see", async () => {
    for (const row of [job({ rider_id: "rider-2" }), job({ rider_id: null }), null]) {
      const { client, rpcs } = fakeClient({ profile: RIDER, row });
      assert.deepEqual(await hideRiderJobAs(client, "rider-1", "req-1"), { ok: false, error: "This job isn't yours." });
      assert.equal(rpcs.length, 0);
    }
  });

  it("refuses a blocked rider and a cook", async () => {
    const blocked = fakeClient({ profile: { role: "rider", is_active: false }, row: job() });
    assert.deepEqual(await hideRiderJobAs(blocked.client, "rider-1", "req-1"), BLOCKED);
    const cook = fakeClient({ row: job() });
    assert.deepEqual(await hideRiderJobAs(cook.client, "rider-1", "req-1"), { ok: false, error: "Only riders can do this." });
    assert.equal(blocked.rpcs.length + cook.rpcs.length, 0);
  });
});

describe("hideAllRiderJobsAs", () => {
  it("lets the database pick the rider's finished jobs", async () => {
    const { client, rpcs } = fakeClient({ profile: RIDER });
    assert.deepEqual(await hideAllRiderJobsAs(client, "rider-1"), { ok: true });
    assert.deepEqual(rpcs, [{ fn: "hide_all_rider_past_jobs", args: undefined }]);
  });

  it("refuses a blocked rider", async () => {
    const { client, rpcs } = fakeClient({ profile: { role: "rider", is_active: false } });
    assert.deepEqual(await hideAllRiderJobsAs(client, "rider-1"), BLOCKED);
    assert.equal(rpcs.length, 0);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  acceptDeliveryAs,
  completeDeliveryAs,
  markCollectedAs,
  isCollected,
  BLOCKED_ACCOUNT_MESSAGE,
  ALREADY_COLLECTED_MESSAGE,
  COLLECT_FIRST_MESSAGE,
} from "./rider-delivery.ts";

type Profile = { role: string; is_active: boolean } | null;
type DbError = { message: string } | null;
type Delivery = { rider_id: string | null; status: string; picked_up_at?: string | null } | null;

const COLLECTED_AT = "2026-10-19T10:00:00Z";

/**
 * Just enough of the Supabase client for rider-delivery.ts: profiles lookup,
 * delivery_requests lookup/update and rpc. Records every write so tests can assert
 * a blocked rider never reaches the database.
 */
function fakeClient({
  profile = { role: "rider", is_active: true } as Profile,
  profileError = null as DbError,
  updateError = null as DbError,
  rpcError = null as DbError,
  throwOn = null as "profiles" | null,
  // The rider's own delivery as the lookup sees it; collected by default.
  delivery = { rider_id: "rider-1", status: "accepted", picked_up_at: COLLECTED_AT } as Delivery,
  deliveryError = null as DbError,
} = {}) {
  const writes: { kind: "update" | "rpc"; table?: string; values?: unknown; filters?: [string, unknown][]; fn?: string; args?: unknown }[] = [];
  const client = {
    from(table: string) {
      if (throwOn === table) throw new Error("network down");
      if (table === "profiles") {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({ data: profile, error: profileError }),
        };
        return q;
      }
      const filters: [string, unknown][] = [];
      const write = { kind: "update" as const, table, values: undefined as unknown, filters };
      const q = {
        select: () => q,
        maybeSingle: async () => ({ data: delivery, error: deliveryError }),
        update(values: unknown) {
          write.values = values;
          writes.push(write);
          return q;
        },
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return q;
        },
        then(resolve: (v: { error: DbError }) => void) {
          resolve({ error: updateError });
        },
      };
      return q;
    },
    async rpc(fn: string, args: unknown) {
      writes.push({ kind: "rpc", fn, args });
      return { error: rpcError };
    },
  };
  return { client: client as unknown as Parameters<typeof acceptDeliveryAs>[0], writes };
}

const BLOCKED = { ok: false, error: "Your account is blocked.", blocked: true };

describe("acceptDeliveryAs", () => {
  it("refuses a blocked rider with a clean result and never writes", async () => {
    const { client, writes } = fakeClient({ profile: { role: "rider", is_active: false } });
    const result = await acceptDeliveryAs(client, "rider-1", "req-1");
    assert.deepEqual(result, BLOCKED);
    assert.equal(BLOCKED_ACCOUNT_MESSAGE, "Your account is blocked.");
    assert.equal(writes.length, 0);
  });

  it("accepts for an active rider, as the session user, only while the request is open", async () => {
    const { client, writes } = fakeClient();
    const result = await acceptDeliveryAs(client, "rider-1", "req-1");
    assert.deepEqual(result, { ok: true });
    assert.equal(writes.length, 1);
    const w = writes[0];
    assert.equal(w.table, "delivery_requests");
    assert.equal((w.values as { rider_id: string }).rider_id, "rider-1");
    assert.equal((w.values as { status: string }).status, "accepted");
    assert.deepEqual(w.filters, [
      ["id", "req-1"],
      ["status", "open"],
    ]);
  });

  it("maps the database's blocked refusal (block landed mid-request) to the same result", async () => {
    const { client } = fakeClient({ updateError: { message: "Your account is blocked." } });
    assert.deepEqual(await acceptDeliveryAs(client, "rider-1", "req-1"), BLOCKED);
  });

  it("passes other database errors through without the blocked flag", async () => {
    const { client } = fakeClient({ updateError: { message: "new row violates row-level security policy" } });
    assert.deepEqual(await acceptDeliveryAs(client, "rider-1", "req-1"), {
      ok: false,
      error: "new row violates row-level security policy",
    });
  });

  it("refuses someone who isn't a rider", async () => {
    const { client, writes } = fakeClient({ profile: { role: "cook", is_active: true } });
    const result = await acceptDeliveryAs(client, "u-1", "req-1");
    assert.equal(result.ok, false);
    assert.equal(writes.length, 0);
  });

  it("refuses when the profile can't be loaded", async () => {
    const { client, writes } = fakeClient({ profile: null, profileError: { message: "boom" } });
    const result = await acceptDeliveryAs(client, "rider-1", "req-1");
    assert.equal(result.ok, false);
    assert.equal(writes.length, 0);
  });

  it("returns a result instead of throwing when the client throws", async () => {
    const { client } = fakeClient({ throwOn: "profiles" });
    const result = await acceptDeliveryAs(client, "rider-1", "req-1");
    assert.equal(result.ok, false);
  });

  it("refuses an empty request id", async () => {
    const { client, writes } = fakeClient();
    assert.equal((await acceptDeliveryAs(client, "rider-1", "")).ok, false);
    assert.equal(writes.length, 0);
  });
});

describe("completeDeliveryAs", () => {
  it("refuses a blocked rider and never calls complete_delivery_with_proof", async () => {
    const { client, writes } = fakeClient({ profile: { role: "rider", is_active: false } });
    const result = await completeDeliveryAs(client, "rider-1", "req-1", "order/rider-1/p.jpg");
    assert.deepEqual(result, BLOCKED);
    assert.equal(writes.length, 0);
  });

  it("completes for an active rider via the proof RPC", async () => {
    const { client, writes } = fakeClient();
    const result = await completeDeliveryAs(client, "rider-1", "req-1", "order/rider-1/p.jpg");
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(writes, [
      { kind: "rpc", fn: "complete_delivery_with_proof", args: { p_request_id: "req-1", p_photo_path: "order/rider-1/p.jpg" } },
    ]);
  });

  it("maps the database's blocked refusal to the blocked result", async () => {
    const { client } = fakeClient({ rpcError: { message: "Your account is blocked." } });
    assert.deepEqual(await completeDeliveryAs(client, "rider-1", "req-1", "p.jpg"), BLOCKED);
  });
});

describe("isCollected", () => {
  it("is false only while picked_up_at is null", () => {
    assert.equal(isCollected({ picked_up_at: null }), false);
    assert.equal(isCollected({ picked_up_at: COLLECTED_AT }), true);
  });

  it("treats a database without the column (undefined) as the old flow, so riders aren't stuck", () => {
    assert.equal(isCollected({}), true);
  });
});

describe("markCollectedAs", () => {
  const NOT_COLLECTED = { rider_id: "rider-1", status: "accepted", picked_up_at: null };

  it("marks the food collected for the assigned rider via the database (its clock, not ours)", async () => {
    const { client, writes } = fakeClient({ delivery: NOT_COLLECTED });
    assert.deepEqual(await markCollectedAs(client, "rider-1", "req-1"), { ok: true });
    assert.deepEqual(writes, [{ kind: "rpc", fn: "mark_delivery_picked_up", args: { p_request_id: "req-1" } }]);
  });

  it("refuses a blocked rider and never writes", async () => {
    const { client, writes } = fakeClient({ profile: { role: "rider", is_active: false }, delivery: NOT_COLLECTED });
    assert.deepEqual(await markCollectedAs(client, "rider-1", "req-1"), BLOCKED);
    assert.equal(writes.length, 0);
  });

  it("refuses a rider who isn't assigned to the job", async () => {
    const { client, writes } = fakeClient({ delivery: { ...NOT_COLLECTED, rider_id: "rider-2" } });
    assert.deepEqual(await markCollectedAs(client, "rider-1", "req-1"), { ok: false, error: "This delivery is no longer active." });
    assert.equal(writes.length, 0);
  });

  it("refuses a delivered, cancelled or missing job", async () => {
    for (const delivery of [{ ...NOT_COLLECTED, status: "completed" }, { ...NOT_COLLECTED, status: "cancelled" }, null]) {
      const { client, writes } = fakeClient({ delivery });
      assert.equal((await markCollectedAs(client, "rider-1", "req-1")).ok, false);
      assert.equal(writes.length, 0);
    }
  });

  it("refuses to mark it twice", async () => {
    const { client, writes } = fakeClient();
    assert.deepEqual(await markCollectedAs(client, "rider-1", "req-1"), { ok: false, error: ALREADY_COLLECTED_MESSAGE });
    assert.equal(writes.length, 0);
  });

  it("passes the database's refusals through (cancelled order, block mid-request)", async () => {
    const cancelled = fakeClient({ delivery: NOT_COLLECTED, rpcError: { message: "This order was cancelled — no need to collect it." } });
    assert.deepEqual(await markCollectedAs(cancelled.client, "rider-1", "req-1"), {
      ok: false,
      error: "This order was cancelled — no need to collect it.",
    });
    const blocked = fakeClient({ delivery: NOT_COLLECTED, rpcError: { message: "Your account is blocked." } });
    assert.deepEqual(await markCollectedAs(blocked.client, "rider-1", "req-1"), BLOCKED);
  });

  it("refuses when the job can't be loaded, or the id is empty", async () => {
    const failing = fakeClient({ delivery: null, deliveryError: { message: "boom" } });
    assert.equal((await markCollectedAs(failing.client, "rider-1", "req-1")).ok, false);
    assert.equal(failing.writes.length, 0);
    const empty = fakeClient({ delivery: NOT_COLLECTED });
    assert.equal((await markCollectedAs(empty.client, "rider-1", "")).ok, false);
    assert.equal(empty.writes.length, 0);
  });
});

describe("completeDeliveryAs — collected first", () => {
  it("refuses to deliver before the food is collected", async () => {
    const { client, writes } = fakeClient({ delivery: { rider_id: "rider-1", status: "accepted", picked_up_at: null } });
    assert.deepEqual(await completeDeliveryAs(client, "rider-1", "req-1", "p.jpg"), { ok: false, error: COLLECT_FIRST_MESSAGE });
    assert.equal(writes.length, 0);
  });

  it("delivers as before when the database has no pickup column yet", async () => {
    const { client, writes } = fakeClient({ delivery: { rider_id: "rider-1", status: "accepted" } });
    assert.deepEqual(await completeDeliveryAs(client, "rider-1", "req-1", "p.jpg"), { ok: true });
    assert.equal(writes.length, 1);
  });

  it("refuses someone else's delivery", async () => {
    const { client, writes } = fakeClient({ delivery: { rider_id: "rider-2", status: "accepted", picked_up_at: COLLECTED_AT } });
    assert.equal((await completeDeliveryAs(client, "rider-1", "req-1", "p.jpg")).ok, false);
    assert.equal(writes.length, 0);
  });
});

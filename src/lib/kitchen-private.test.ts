import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { KITCHEN_COLUMNS, KITCHEN_PRIVATE_COLUMNS, isMissingFunction, loadMyKitchenPrivate, saveKitchenRow } from "./kitchen-private.ts";

// Phase 1's public list (Customer repo docs/supabase-kitchen-privacy.sql), granted to authenticated by Phase 2 Part B.
const PUBLIC_COLUMNS = [
  "id", "business_name", "category", "cuisine_type", "neighbourhood", "description", "hero_image", "is_live",
  "created_at", "updated_at", "business_uen", "postal_sector", "is_halal", "is_blocked", "live_since",
];

describe("kitchen columns", () => {
  it("the app's kitchens column list is all public, with none of the 5 private columns", () => {
    const columns = KITCHEN_COLUMNS.split(",").map((c) => c.trim());
    for (const c of columns) assert.ok(PUBLIC_COLUMNS.includes(c), c);
    for (const c of KITCHEN_PRIVATE_COLUMNS) assert.ok(!columns.includes(c), c);
    assert.deepEqual([...KITCHEN_PRIVATE_COLUMNS].sort(), ["acknowledged_terms_at", "latitude", "longitude", "paynow_type", "paynow_value"]);
  });
});

/** Every .ts / .tsx file under src (tests included: nothing should do it). */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("source scan", () => {
  const src = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const files = sourceFiles(src);

  it("finds the source files", () => {
    assert.ok(files.length > 20);
    assert.ok(files.some((f) => f.endsWith("KitchenSetupForm.tsx")));
  });

  it('never has from("kitchens").select("*") — it fails once signed-in users lose the private columns', () => {
    // Also catches spacing, quotes and line breaks between the two calls.
    const pattern = /from\(\s*["'`]kitchens["'`]\s*\)\s*\.select\(\s*["'`]\s*\*\s*["'`]\s*[,)]/;
    const hits = files.filter((f) => !f.endsWith("kitchen-private.test.ts") && pattern.test(readFileSync(f, "utf8")));
    assert.deepEqual(hits, []);
  });

  it("never upserts kitchens (an upsert needs SELECT on the private columns it sets)", () => {
    const pattern = /from\(\s*["'`]kitchens["'`]\s*\)\s*\.upsert\(/;
    const hits = files.filter((f) => !f.endsWith("kitchen-private.test.ts") && pattern.test(readFileSync(f, "utf8")));
    assert.deepEqual(hits, []);
  });

  it("the scan pattern does catch the forms it's meant to", () => {
    const pattern = /from\(\s*["'`]kitchens["'`]\s*\)\s*\.select\(\s*["'`]\s*\*\s*["'`]\s*[,)]/;
    assert.ok(pattern.test(`supabase.from("kitchens").select("*")`));
    assert.ok(pattern.test(`supabase.from('kitchens')\n  .select('*', { count: "exact" })`));
    assert.ok(!pattern.test(`supabase.from("kitchens").select("id, business_name")`));
    assert.ok(!pattern.test(`supabase.from("menu_items").select("*")`));
  });
});

type Call = { kind: string; args: unknown[] };

/** A fake Supabase client: rpc("get_my_kitchen_private"), and from("kitchens") select / insert / update. */
function fakeClient(opts: {
  rpc?: { data: unknown; error: { code?: string; message: string } | null };
  select?: { data: unknown; error: { code?: string; message: string } | null };
  insertError?: { code?: string; message: string } | null;
  updateError?: { code?: string; message: string } | null;
  throws?: boolean;
}) {
  const calls: Call[] = [];
  const client = {
    async rpc(name: string, args?: unknown) {
      calls.push({ kind: "rpc", args: [name, args] });
      if (opts.throws) throw new Error("network");
      return opts.rpc ?? { data: [], error: null };
    },
    from(table: string) {
      return {
        select(columns: string) {
          calls.push({ kind: "select", args: [table, columns] });
          const q = {
            eq: (col: string, val: unknown) => {
              calls.push({ kind: "eq", args: [col, val] });
              return q;
            },
            maybeSingle: async () => opts.select ?? { data: null, error: null },
          };
          return q;
        },
        async insert(row: unknown) {
          calls.push({ kind: "insert", args: [table, row] });
          return { error: opts.insertError ?? null };
        },
        update(row: unknown) {
          calls.push({ kind: "update", args: [table, row] });
          return {
            eq: async (col: string, val: unknown) => {
              calls.push({ kind: "eq", args: [col, val] });
              return { error: opts.updateError ?? null };
            },
          };
        },
      };
    },
  };
  return { client: client as never, calls };
}

const PRIVATE = { paynow_type: "mobile", paynow_value: "91234567", acknowledged_terms_at: "2026-01-01T00:00:00Z" };

describe("loadMyKitchenPrivate", () => {
  it("uses get_my_kitchen_private and never reads kitchens", async () => {
    const { client, calls } = fakeClient({ rpc: { data: [{ ...PRIVATE, extra: "ignored" }], error: null } });
    assert.deepEqual(await loadMyKitchenPrivate(client, "k1"), { ok: true, data: PRIVATE });
    assert.deepEqual(calls.map((c) => c.kind), ["rpc"]);
    assert.equal(calls[0].args[0], "get_my_kitchen_private");
  });

  it("is ok with no row (no kitchen yet)", async () => {
    const { client } = fakeClient({ rpc: { data: [], error: null } });
    assert.deepEqual(await loadMyKitchenPrivate(client, "k1"), { ok: true, data: null });
  });

  it("falls back to the 3 columns (never *) when the function doesn't exist yet", async () => {
    for (const code of ["PGRST202", "42883"]) {
      const { client, calls } = fakeClient({ rpc: { data: null, error: { code, message: "missing" } }, select: { data: PRIVATE, error: null } });
      assert.deepEqual(await loadMyKitchenPrivate(client, "k1"), { ok: true, data: PRIVATE });
      assert.deepEqual(calls[1].args, ["kitchens", "paynow_type, paynow_value, acknowledged_terms_at"]);
      assert.deepEqual(calls[2].args, ["id", "k1"]);
    }
  });

  it("is not ok on any other error, and doesn't fall back", async () => {
    const { client, calls } = fakeClient({ rpc: { data: null, error: { code: "42501", message: "permission denied" } } });
    assert.deepEqual(await loadMyKitchenPrivate(client, "k1"), { ok: false });
    assert.deepEqual(calls.map((c) => c.kind), ["rpc"]);
  });

  it("is not ok when the fallback read fails (e.g. the lock is on but the function is gone)", async () => {
    const { client } = fakeClient({
      rpc: { data: null, error: { code: "PGRST202", message: "missing" } },
      select: { data: null, error: { code: "42501", message: "permission denied" } },
    });
    assert.deepEqual(await loadMyKitchenPrivate(client, "k1"), { ok: false });
  });

  it("is not ok when the call throws", async () => {
    const { client } = fakeClient({ throws: true });
    assert.deepEqual(await loadMyKitchenPrivate(client, "k1"), { ok: false });
  });

  it("knows the 'function missing' codes", () => {
    assert.equal(isMissingFunction({ code: "PGRST202", message: "" }), true);
    assert.equal(isMissingFunction({ code: "42883", message: "" }), true);
    assert.equal(isMissingFunction({ code: "42501", message: "" }), false);
    assert.equal(isMissingFunction(null), false);
  });
});

describe("saveKitchenRow", () => {
  const row = { business_name: "Aunty May", paynow_type: "mobile", paynow_value: "91234567", acknowledged_terms_at: "now" };

  it("inserts on the first save (no row loaded), with the cook's id", async () => {
    const { client, calls } = fakeClient({});
    assert.deepEqual(await saveKitchenRow(client, "k1", false, row), { error: null });
    assert.deepEqual(calls, [{ kind: "insert", args: ["kitchens", { ...row, id: "k1" }] }]);
  });

  it("updates when the kitchen already exists", async () => {
    const { client, calls } = fakeClient({});
    assert.deepEqual(await saveKitchenRow(client, "k1", true, row), { error: null });
    assert.deepEqual(calls, [
      { kind: "update", args: ["kitchens", row] },
      { kind: "eq", args: ["id", "k1"] },
    ]);
  });

  it('retries as an update on "already exists" (23505)', async () => {
    const { client, calls } = fakeClient({ insertError: { code: "23505", message: "duplicate key" } });
    assert.deepEqual(await saveKitchenRow(client, "k1", false, row), { error: null });
    assert.deepEqual(calls.map((c) => c.kind), ["insert", "update", "eq"]);
  });

  it("returns any other insert error without updating", async () => {
    const err = { code: "23514", message: "Please acknowledge the Kopi Boy partner terms" };
    const { client, calls } = fakeClient({ insertError: err });
    assert.deepEqual(await saveKitchenRow(client, "k1", false, row), { error: err });
    assert.deepEqual(calls.map((c) => c.kind), ["insert"]);
  });

  it("returns an update error", async () => {
    const err = { code: "42501", message: "permission denied" };
    const { client } = fakeClient({ updateError: err });
    assert.deepEqual(await saveKitchenRow(client, "k1", true, row), { error: err });
  });

  it("never upserts and never asks for anything back", async () => {
    const { client, calls } = fakeClient({ insertError: { code: "23505", message: "dup" } });
    await saveKitchenRow(client, "k1", false, row);
    assert.ok(calls.every((c) => c.kind !== "upsert" && c.kind !== "select"));
  });
});

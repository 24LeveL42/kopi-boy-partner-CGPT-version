import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  PICK_A_REGION_MESSAGE,
  REGIONS,
  isRegionCode,
  loadKitchenRegion,
  loadMyRideRegions,
  normalizeRegions,
  regionLabel,
  rideRegionsSaveMessage,
  sameRegions,
  saveMyRideRegions,
  shouldPromptForRideRegions,
  validateRideRegions,
} from "./ride-regions.ts";

type Result = { data: unknown; error: { code?: string; message: string } | null };
type Call = { kind: string; args: unknown[] };

/** A fake Supabase client: rpc(), and from(table).select(cols).eq(col, val) awaited directly or via maybeSingle(). */
function fakeClient(opts: { rpc?: Result; select?: Result; throws?: boolean } = {}) {
  const calls: Call[] = [];
  const result = () => {
    if (opts.throws) return Promise.reject(new Error("network"));
    return Promise.resolve(opts.select ?? { data: [], error: null });
  };
  const client = {
    async rpc(name: string, args?: unknown) {
      calls.push({ kind: "rpc", args: [name, args] });
      if (opts.throws) throw new Error("network");
      return opts.rpc ?? { data: null, error: null };
    },
    from(table: string) {
      return {
        select(columns: string) {
          calls.push({ kind: "select", args: [table, columns] });
          const q = {
            eq(col: string, val: unknown) {
              calls.push({ kind: "eq", args: [col, val] });
              return q;
            },
            maybeSingle: () => result(),
            then: (ok: (v: Result) => unknown, fail?: (e: unknown) => unknown) => result().then(ok, fail),
          };
          return q;
        },
      };
    },
  };
  return { client: client as never, calls };
}

describe("regions list", () => {
  it("is exactly north, south, east, west in that order, with labels", () => {
    assert.deepEqual(REGIONS.map((r) => `${r.code}:${r.label}`), ["north:North", "south:South", "east:East", "west:West"]);
    assert.equal(regionLabel("east"), "East");
    assert.equal(regionLabel("central"), null);
    assert.equal(regionLabel(null), null);
    assert.ok(isRegionCode("west"));
    assert.ok(!isRegionCode("West"));
  });
});

describe("validateRideRegions / normalizeRegions", () => {
  it("needs at least one region", () => {
    assert.deepEqual(validateRideRegions([]), { ok: false, message: PICK_A_REGION_MESSAGE });
    assert.deepEqual(validateRideRegions(["central", "", null]), { ok: false, message: PICK_A_REGION_MESSAGE });
  });

  it("keeps known codes only, once each, in the fixed order (trimmed, any case)", () => {
    assert.deepEqual(validateRideRegions(["west", " North ", "north", "central", 3]), { ok: true, regions: ["north", "west"] });
    assert.deepEqual(normalizeRegions(["east", "south", "north", "west"]), ["north", "south", "east", "west"]);
  });

  it("sameRegions ignores order and duplicates", () => {
    assert.ok(sameRegions(["east", "north"], ["north", "east", "east"]));
    assert.ok(!sameRegions(["east"], ["east", "west"]));
    assert.ok(sameRegions([], []));
  });
});

describe("loadMyRideRegions", () => {
  it("reads only the region column of the rider's own rows", async () => {
    const { client, calls } = fakeClient({ select: { data: [{ region: "west" }, { region: "north" }], error: null } });
    assert.deepEqual(await loadMyRideRegions(client, "u1"), { ok: true, regions: ["north", "west"] });
    assert.deepEqual(calls, [
      { kind: "select", args: ["rider_regions", "region"] },
      { kind: "eq", args: ["user_id", "u1"] },
    ]);
  });

  it("no rows is ok with none", async () => {
    const { client } = fakeClient({ select: { data: [], error: null } });
    assert.deepEqual(await loadMyRideRegions(client, "u1"), { ok: true, regions: [] });
  });

  it("an error or a network failure is not ok", async () => {
    assert.deepEqual(await loadMyRideRegions(fakeClient({ select: { data: null, error: { code: "42501", message: "denied" } } }).client, "u1"), { ok: false });
    assert.deepEqual(await loadMyRideRegions(fakeClient({ throws: true }).client, "u1"), { ok: false });
  });
});

describe("shouldPromptForRideRegions", () => {
  it("prompts only when the read worked and found none", () => {
    assert.equal(shouldPromptForRideRegions({ ok: true, regions: [] }), true);
    assert.equal(shouldPromptForRideRegions({ ok: true, regions: ["east"] }), false);
    assert.equal(shouldPromptForRideRegions({ ok: false }), false);
    assert.equal(shouldPromptForRideRegions(null), false);
  });
});

describe("saveMyRideRegions", () => {
  it("calls set_my_ride_regions with p_regions, cleaned and in order", async () => {
    const { client, calls } = fakeClient();
    assert.equal(await saveMyRideRegions(client, ["west", "east", "east"]), null);
    assert.deepEqual(calls, [{ kind: "rpc", args: ["set_my_ride_regions", { p_regions: ["east", "west"] }] }]);
  });

  it("stops before calling the database when nothing valid is picked", async () => {
    const { client, calls } = fakeClient();
    assert.equal(await saveMyRideRegions(client, []), PICK_A_REGION_MESSAGE);
    assert.deepEqual(calls, []);
  });

  it("turns database errors into a clear message", async () => {
    const cases: [{ code?: string; message: string }, RegExp][] = [
      [{ code: "22023", message: "Pick at least one region." }, /Pick at least one region/],
      [{ code: "22023", message: "Unknown region. Use north, south, east or west." }, /isn't one of North, South, East or West/],
      [{ code: "42501", message: "Sign in first." }, /sign in again/],
      [{ code: "42501", message: "Only riders and rider applicants have ride regions." }, /Only riders and rider applicants/],
      [{ code: "PGRST202", message: "Could not find the function" }, /isn't available yet/],
      [{ code: "08000", message: "boom" }, /Couldn't save your regions/],
    ];
    for (const [error, expected] of cases) {
      const { client } = fakeClient({ rpc: { data: null, error } });
      const original = console.error;
      console.error = () => {};
      try {
        assert.match((await saveMyRideRegions(client, ["north"])) ?? "", expected, error.message);
      } finally {
        console.error = original;
      }
    }
  });

  it("a network failure gives the generic message", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      assert.match((await saveMyRideRegions(fakeClient({ throws: true }).client, ["north"])) ?? "", /Couldn't save your regions/);
    } finally {
      console.error = original;
    }
    assert.match(rideRegionsSaveMessage(null), /Couldn't save your regions/);
  });
});

describe("loadKitchenRegion", () => {
  it("names only the region column, for the cook's own kitchen", async () => {
    const { client, calls } = fakeClient({ select: { data: { region: "east" }, error: null } });
    assert.equal(await loadKitchenRegion(client, "k1"), "east");
    assert.deepEqual(calls, [
      { kind: "select", args: ["kitchens", "region"] },
      { kind: "eq", args: ["id", "k1"] },
    ]);
  });

  it("is null with no kitchen, no region, an unknown value, or any error (column missing / not granted)", async () => {
    assert.equal(await loadKitchenRegion(fakeClient({ select: { data: null, error: null } }).client, "k1"), null);
    assert.equal(await loadKitchenRegion(fakeClient({ select: { data: { region: null }, error: null } }).client, "k1"), null);
    assert.equal(await loadKitchenRegion(fakeClient({ select: { data: { region: "central" }, error: null } }).client, "k1"), null);
    for (const code of ["42703", "42501"]) {
      assert.equal(await loadKitchenRegion(fakeClient({ select: { data: null, error: { code, message: "x" } } }).client, "k1"), null, code);
    }
    assert.equal(await loadKitchenRegion(fakeClient({ throws: true }).client, "k1"), null);
  });
});

/** Every .ts / .tsx file under src. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("source scan: riders' regions", () => {
  const src = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const files = sourceFiles(src).filter((f) => !f.endsWith("ride-regions.test.ts"));
  const read = (f: string) => readFileSync(f, "utf8");

  it("never writes rider_regions directly (set_my_ride_regions is the only way)", () => {
    const pattern = /from\(\s*["'`]rider_regions["'`]\s*\)\s*\.(insert|update|upsert|delete)\(/;
    assert.deepEqual(files.filter((f) => pattern.test(read(f))), []);
  });

  it("only ever selects the region column from rider_regions", () => {
    const selects = files.flatMap((f) => [...read(f).matchAll(/from\(\s*["'`]rider_regions["'`]\s*\)\s*\.select\(\s*["'`]([^"'`]*)["'`]/g)].map((m) => m[1]));
    assert.deepEqual(selects, ["region"]);
  });

  it("the rider region screens never ask for an address or postal code", () => {
    for (const name of ["RideRegionsPicker.tsx", "RideRegionsForm.tsx", "RideRegionsPrompt.tsx", "ride-regions.ts"]) {
      const file = files.find((f) => f.endsWith(name));
      assert.ok(file, name);
      assert.doesNotMatch(read(file), /postal_code|business_address|postalCode|latitude|longitude/, name);
    }
  });

  it("the kitchen save never sends region (the database derives it)", () => {
    const form = read(files.find((f) => f.endsWith("KitchenSetupForm.tsx"))!);
    // An object key (region: x, or shorthand { region }), not the "Your region:" text.
    const key = /[{,]\s*region\s*[:,}]/;
    assert.ok(key.test("{ id, region }") && key.test("{ name: n, region: r }") && !key.test("Your region:"));
    assert.doesNotMatch(form, key);
  });
});

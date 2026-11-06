import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/**
 * docs/supabase-regions.sql, run for real (PGlite) on top of the real schema
 * sections it builds on: user_has_role (section 1), cook/rider applications
 * (sections 2 and 3), the kitchens RLS policies and grants (section 6), the
 * updated_at trigger (section 8), the private kitchen location (section 28),
 * its public derived columns (section 29) and the terms trigger (section 33),
 * then the real kitchen privacy Phase 2 (Part A + Part B) with a stand-in for
 * Phase 1's 15-column anon grant.
 */

// Normalised to \n so the section markers below match on a Windows checkout.
const docs = (name: string) => readFileSync(new URL(`../../docs/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const SQL = docs("supabase-regions.sql");
const SCHEMA_SQL = docs("supabase-schema.sql");
const PHASE2_SQL = docs("supabase-kitchen-privacy-phase2.sql");

function between(text: string, start: string, end: string): string {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`section not found: ${start}`);
  return text.slice(a, b);
}

const RULE = "-- ----------------------------------------------------------------------------\n";

const PART_A = between(SQL, "-- PART A — REGIONS, SECTOR MAP, kitchens.region", "-- PART B — RIDERS' REGIONS");
const PART_B = between(SQL, "-- PART B — RIDERS' REGIONS", "-- CHECKS AFTER PART A");

/** The read-only check queries at the end of the file, uncommented, by their number. */
const CHECKS: Record<number, string> = {};
{
  let n = 0;
  for (const line of between(SQL, "-- CHECKS AFTER PART A", "-- UNDO (").split("\n")) {
    const num = /^-- (\d+)\. /.exec(line);
    if (num) n = Number(num[1]);
    else if (/^-- select /.test(line)) CHECKS[n] = line.replace(/^-- /, "");
  }
}
const uncomment = (block: string) =>
  block.split("\n").filter((l) => /^-- {3}/.test(l)).map((l) => l.replace(/^-- {3}/, "")).join("\n");
const UNDO_B = uncomment(between(SQL, "-- UNDO PART B:", "-- UNDO PART A:"));
const UNDO_A = uncomment(SQL.slice(SQL.indexOf("-- UNDO PART A:")));

const PHASE2_A = between(PHASE2_SQL, "-- PART A — ADDITIVE", "-- PART B — THE LOCK");
const PHASE2_B = between(PHASE2_SQL, "-- PART B — THE LOCK", "-- CHECKS AFTERWARDS");

const SECTION_29 = between(SCHEMA_SQL, "alter table public.kitchens add column if not exists postal_sector text;", RULE + "-- 30.");

const PUBLIC_COLUMNS = [
  "id", "business_name", "category", "cuisine_type", "neighbourhood", "description", "hero_image", "is_live",
  "created_at", "updated_at", "business_uen", "postal_sector", "is_halal", "is_blocked", "live_since",
];
const PRIVATE_COLUMNS = ["paynow_type", "paynow_value", "latitude", "longitude", "acknowledged_terms_at"];

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const EAST_COOK = id(1); // 460123
const NORTH_COOK = id(2); // 560123
const WEST_COOK = id(3); // 600123
const SOUTH_COOK = id(4); // 090123
const UNMAPPED_COOK = id(5); // 740123 (sector 74 is not in use)
const NO_ADDRESS_COOK = id(6);
const NEW_COOK = id(7); // cook role, no kitchen yet
const ADMIN = id(400);
const CUSTOMER = id(500);
const RIDER = id(600); // rider role, approved application
const APPLICANT = id(601); // still a customer, pending rider application
const ROLE_ONLY_RIDER = id(602); // rider role, no application on file

const KITCHENS = [
  [EAST_COOK, "460123"],
  [NORTH_COOK, "560123"],
  [WEST_COOK, "600123"],
  [SOUTH_COOK, "090123"],
  [UNMAPPED_COOK, "740123"],
  [NO_ADDRESS_COOK, null],
] as const;

const schema = (withSection29 = true) => `
create role anon;
create role authenticated;
create schema auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
create table auth.users (id uuid primary key);

create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, role text not null default 'customer');
${between(SCHEMA_SQL, "create or replace function public.user_has_role(check_role text)", 'drop policy if exists "Users can read their own profile"')}

${between(SCHEMA_SQL, "create table if not exists public.cook_applications (", RULE + "-- 3. RIDER APPLICATIONS")}
${between(SCHEMA_SQL, "create table if not exists public.rider_applications (", RULE + "-- 4. AUTO-CREATE")}

create table public.kitchens (
  id uuid primary key references public.profiles(id) on delete cascade,
  business_name text not null,
  category text,
  cuisine_type text,
  neighbourhood text,
  description text,
  hero_image text,
  is_live boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paynow_type text,
  paynow_value text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  business_uen text,
  is_halal boolean not null default false,
  acknowledged_terms_at timestamptz,
  is_blocked boolean not null default false,
  live_since timestamptz
);
alter table public.kitchens enable row level security;
${between(SCHEMA_SQL, "grant select, insert, update on public.kitchens to authenticated;", RULE + "-- 7. MENU ITEMS")}
${between(SCHEMA_SQL, "create or replace function public.touch_kitchen_updated_at()", "-- ============================================================================\n-- KOPI BOY 2.0 — Picker role")}
${between(SCHEMA_SQL, "alter table public.cook_applications add column if not exists business_address text;", RULE + "-- 29.")}
${withSection29 ? SECTION_29 : ""}

-- Phase 1 stand-in (Customer repo): anon on the 15 public columns only.
revoke select on public.kitchens from anon;
${withSection29 ? `grant select (${PUBLIC_COLUMNS.join(", ")}) on public.kitchens to anon;` : ""}

-- Seed as the table owner, before the terms trigger (it would restamp the dates).
insert into auth.users (id) values
  ${[...KITCHENS.map(([k]) => k), NEW_COOK, ADMIN, CUSTOMER, RIDER, APPLICANT, ROLE_ONLY_RIDER].map((u) => `('${u}')`).join(", ")};
insert into public.profiles (id, role) values
  ${KITCHENS.map(([k]) => `('${k}', 'cook')`).join(", ")},
  ('${NEW_COOK}', 'cook'), ('${ADMIN}', 'admin'), ('${CUSTOMER}', 'customer'),
  ('${RIDER}', 'rider'), ('${APPLICANT}', 'customer'), ('${ROLE_ONLY_RIDER}', 'rider');
insert into public.kitchens (id, business_name, is_live, paynow_type, paynow_value, acknowledged_terms_at) values
  ${KITCHENS.map(([k], i) => `('${k}', 'Kitchen ${i + 1}', true, 'mobile', '9123456${i}', '2026-01-01T00:00:00Z')`).join(",\n  ")};
insert into public.kitchen_addresses (kitchen_id, business_address, postal_code, latitude, longitude) values
  ${KITCHENS.filter(([, pc]) => pc).map(([k, pc]) => `('${k}', '1 Test Road', '${pc}', 1.345678, 103.876543)`).join(",\n  ")};
insert into public.rider_applications (user_id, vehicle_type, status) values
  ('${RIDER}', 'Bicycle', 'approved'), ('${APPLICANT}', 'Motorcycle', 'pending');

${between(SCHEMA_SQL, "create or replace function public.stamp_kitchen_terms_acknowledgement()", RULE + "-- 34.")}
`;

/** The real chain up to (not including) supabase-regions.sql. */
async function baseDb(withSection29 = true): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(schema(withSection29));
  if (withSection29) {
    await db.exec(PHASE2_A);
    await db.exec(PHASE2_B);
  }
  return db;
}

async function fullDb(): Promise<PGlite> {
  const db = await baseDb();
  await db.exec(PART_A);
  await db.exec(PART_B);
  return db;
}

type Role = "anon" | "authenticated";

/** Runs fn as `role` / signed-in `uid`, inside a transaction that's always rolled back. */
async function as<T>(db: PGlite, role: Role, uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
    await db.exec(`set local role ${role}`);
    return await fn();
  } finally {
    await db.exec("rollback");
  }
}

/** The error message, or "" if the statement worked. Inside a savepoint, so the transaction survives a failure. */
async function attempt(db: PGlite, sql: string, params: unknown[] = []): Promise<string> {
  await db.exec("savepoint attempt");
  try {
    await db.query(sql, params);
    await db.exec("release savepoint attempt");
    return "";
  } catch (e) {
    await db.exec("rollback to savepoint attempt");
    return (e as Error).message;
  }
}

/** Runs a whole multi-statement file part; returns its error message, rolling back the failed transaction. */
async function attemptFile(db: PGlite, sql: string): Promise<string> {
  try {
    await db.exec(sql);
    return "";
  } catch (e) {
    await db.exec("rollback");
    return (e as Error).message;
  }
}

const rows = async <T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

/** A Postgres text[] literal for a $n::text[] parameter. */
const arr = (values: string[]) => `{${values.map((v) => `"${v.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;

const regionOf = async (db: PGlite, kitchen: string) =>
  (await rows<{ region: string | null }>(db, "select region from public.kitchens where id = $1", [kitchen]))[0]?.region;

const regionsOf = async (db: PGlite, user: string) =>
  (await rows<{ region: string }>(db, "select region from public.rider_regions where user_id = $1 order by region", [user])).map((r) => r.region);

const updatedAt = async (db: PGlite) =>
  Object.fromEntries(
    (await rows<{ id: string; updated_at: Date }>(db, "select id, updated_at from public.kitchens")).map((r) => [r.id, new Date(r.updated_at).toISOString()])
  );

const exists = async (db: PGlite, regclass: string) =>
  (await rows<{ ok: boolean }>(db, "select to_regclass($1) is not null as ok", [regclass]))[0].ok;

describe("regions SQL — Part A on the real chain (first run)", () => {
  let db: PGlite;
  let before_: Record<string, string>;
  before(async () => {
    db = await baseDb();
    before_ = await updatedAt(db);
    await db.exec(PART_A);
  });
  after(() => db.close());

  it("seeds the 81 sectors exactly as planned (South 30, East 24, West 17, North 10)", async () => {
    const counts = await rows<{ region: string; count: number }>(db, CHECKS[6]);
    assert.deepEqual(
      counts.map((r) => [r.region, Number(r.count)]),
      [["east", 24], ["north", 10], ["south", 30], ["west", 17]]
    );
    const sectors = (await rows<{ sector: string }>(db, "select sector from public.postal_sector_regions order by sector")).map((r) => r.sector);
    const expected = Array.from({ length: 82 }, (_, i) => String(i + 1).padStart(2, "0")).filter((s) => s !== "74");
    assert.deepEqual(sectors, expected);
  });

  it("maps a sample of sectors to the accepted regions", async () => {
    const sample: Record<string, string> = {
      "01": "south", "08": "south", "10": "south", "11": "west", "13": "west", "14": "south", "23": "south", "27": "south",
      "30": "south", "33": "south", "34": "east", "41": "east", "45": "east", "52": "east", "55": "east", "56": "north",
      "57": "north", "59": "west", "68": "west", "71": "west", "73": "north", "76": "north", "78": "north", "80": "north",
      "81": "east", "82": "east",
    };
    const got = Object.fromEntries(
      (await rows<{ sector: string; region: string }>(db, "select sector, region from public.postal_sector_regions where sector = any($1::text[])", [arr(Object.keys(sample))])).map((r) => [r.sector, r.region])
    );
    assert.deepEqual(got, sample);
  });

  it("derives each kitchen's region from its private postal code; unmapped or no address gives NULL", async () => {
    const expected: Record<string, string | null> = {
      [EAST_COOK]: "east", [NORTH_COOK]: "north", [WEST_COOK]: "west", [SOUTH_COOK]: "south", [UNMAPPED_COOK]: null, [NO_ADDRESS_COOK]: null,
    };
    for (const [kitchen, region] of Object.entries(expected)) assert.equal(await regionOf(db, kitchen), region, kitchen);
  });

  it("the backfill touches only kitchens whose region changed, and keeps the terms date", async () => {
    const after_ = await updatedAt(db);
    for (const k of [UNMAPPED_COOK, NO_ADDRESS_COOK]) assert.equal(after_[k], before_[k], k);
    for (const k of [EAST_COOK, NORTH_COOK, WEST_COOK, SOUTH_COOK]) assert.notEqual(after_[k], before_[k], k);
    const terms = await rows<{ t: Date }>(db, "select distinct acknowledged_terms_at as t from public.kitchens");
    assert.deepEqual(terms.map((r) => new Date(r.t).toISOString()), ["2026-01-01T00:00:00.000Z"]);
  });

  it("a second run of Part A changes nothing (no kitchen's updated_at moves)", async () => {
    const snapshot = await updatedAt(db);
    await db.exec(PART_A);
    assert.deepEqual(await updatedAt(db), snapshot);
    assert.equal(Number((await rows<{ n: number }>(db, "select count(*) as n from public.postal_sector_regions"))[0].n), 81);
  });
});

describe("regions SQL — after Part A + Part B", () => {
  let db: PGlite;
  before(async () => {
    db = await fullDb();
  });
  after(() => db.close());

  describe("kitchens.region stays derived", () => {
    it("a cook changing their postal code moves the region (through section 29's AFTER trigger)", async () => {
      const r = await as(db, "authenticated", EAST_COOK, async () => {
        await db.query("update public.kitchen_addresses set postal_code = '600123' where kitchen_id = $1", [EAST_COOK]);
        return { region: await regionOf(db, EAST_COOK), sector: (await rows<{ postal_sector: string }>(db, "select postal_sector from public.kitchens where id = $1", [EAST_COOK]))[0].postal_sector };
      });
      assert.deepEqual(r, { region: "west", sector: "60" });
    });

    it("a cook's UPDATE ... SET region = 'north' is overwritten", async () => {
      const r = await as(db, "authenticated", EAST_COOK, async () => {
        const error = await attempt(db, "update public.kitchens set region = 'north' where id = $1", [EAST_COOK]);
        return { error, region: await regionOf(db, EAST_COOK) };
      });
      assert.deepEqual(r, { error: "", region: "east" });
    });

    it("a new kitchen can't pick its region: NULL until it has an address, then derived", async () => {
      const r = await as(db, "authenticated", NEW_COOK, async () => {
        const insertError = await attempt(
          db,
          "insert into public.kitchens (id, business_name, acknowledged_terms_at, region) values ($1, 'New', now(), 'north')",
          [NEW_COOK]
        );
        const first = await regionOf(db, NEW_COOK);
        await db.query("insert into public.kitchen_addresses (kitchen_id, business_address, postal_code) values ($1, '2 New Road', '520123')", [NEW_COOK]);
        return { insertError, first, then: await regionOf(db, NEW_COOK) };
      });
      assert.deepEqual(r, { insertError: "", first: null, then: "east" });
    });

    it("a value outside the four regions can't be stored even by the owner of the table", async () => {
      await db.exec("begin");
      try {
        await db.exec("alter table public.kitchens disable trigger before_kitchen_region");
        const error = await attempt(db, `update public.kitchens set region = 'central' where id = '${EAST_COOK}'`);
        assert.match(error, /foreign key/);
      } finally {
        await db.exec("rollback");
      }
    });

    it("re-running section 29 afterwards does not stop region updates", async () => {
      await db.exec("begin");
      try {
        await db.exec(SECTION_29);
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [NORTH_COOK]);
        await db.exec("set local role authenticated");
        await db.query("update public.kitchen_addresses set postal_code = '090999' where kitchen_id = $1", [NORTH_COOK]);
        assert.equal(await regionOf(db, NORTH_COOK), "south");
        await db.query("update public.kitchens set region = 'west' where id = $1", [NORTH_COOK]);
        assert.equal(await regionOf(db, NORTH_COOK), "south");
      } finally {
        await db.exec("rollback");
      }
    });
  });

  describe("the sector map", () => {
    it("an admin moving a sector moves only the kitchens in it; the others keep their updated_at", async () => {
      const r = await as(db, "authenticated", ADMIN, async () => {
        const before_ = await updatedAt(db);
        const affected = (await db.query("update public.postal_sector_regions set region = 'north' where sector = '46'")).affectedRows;
        const after_ = await updatedAt(db);
        const changed = Object.keys(after_).filter((k) => after_[k] !== before_[k]).sort();
        return { affected, changed, east: await regionOf(db, EAST_COOK), north: await regionOf(db, NORTH_COOK) };
      });
      assert.equal(r.affected, 1);
      assert.deepEqual(r.changed, [EAST_COOK]);
      assert.equal(r.east, "north");
      assert.equal(r.north, "north");
    });

    it("an admin adding or deleting a sector moves the kitchens in it", async () => {
      const r = await as(db, "authenticated", ADMIN, async () => {
        await db.query("insert into public.postal_sector_regions (sector, region, area) values ('74', 'north', 'Test')");
        await db.query("delete from public.postal_sector_regions where sector = '60'");
        return { unmapped: await regionOf(db, UNMAPPED_COOK), west: await regionOf(db, WEST_COOK) };
      });
      assert.deepEqual(r, { unmapped: "north", west: null });
    });

    it("a non-admin can't change it", async () => {
      for (const uid of [CUSTOMER, EAST_COOK, RIDER]) {
        const r = await as(db, "authenticated", uid, async () => ({
          updated: (await db.query("update public.postal_sector_regions set region = 'west' where sector = '46'")).affectedRows,
          deleted: (await db.query("delete from public.postal_sector_regions where sector = '46'")).affectedRows,
          inserted: await attempt(db, "insert into public.postal_sector_regions (sector, region, area) values ('74', 'west', 'x')"),
        }));
        assert.equal(r.updated, 0, uid);
        assert.equal(r.deleted, 0, uid);
        assert.match(r.inserted, /row-level security/, uid);
      }
      const anon = await as(db, "anon", null, () => attempt(db, "update public.postal_sector_regions set region = 'west' where sector = '46'"));
      assert.match(anon, /permission denied/);
      assert.equal(await regionOf(db, EAST_COOK), "east");
    });

    it("anyone can read it, and the regions", async () => {
      for (const [role, uid] of [["anon", null], ["authenticated", CUSTOMER]] as const) {
        const r = await as(db, role, uid, async () => ({
          sectors: Number((await rows<{ n: number }>(db, "select count(*) as n from public.postal_sector_regions"))[0].n),
          regions: (await rows<{ code: string; label: string }>(db, "select code, label from public.regions order by sort_order")).map((x) => `${x.code}:${x.label}`),
        }));
        assert.deepEqual(r, { sectors: 81, regions: ["north:North", "south:South", "east:East", "west:West"] });
      }
    });
  });

  describe("kitchens grants: 16 public columns", () => {
    it("anon and authenticated each have exactly the 15 public columns plus region", async () => {
      const counts = await rows<{ grantee: string; count: number }>(db, CHECKS[1]);
      assert.deepEqual(counts.map((r) => [r.grantee, Number(r.count)]), [["anon", 16], ["authenticated", 16]]);
      for (const role of ["anon", "authenticated"]) {
        const cols = await rows<{ column_name: string }>(
          db,
          "select column_name from information_schema.column_privileges where table_schema = 'public' and table_name = 'kitchens' and privilege_type = 'SELECT' and grantee = $1",
          [role]
        );
        assert.deepEqual(cols.map((c) => c.column_name).sort(), [...PUBLIC_COLUMNS, "region"].sort(), role);
      }
      assert.deepEqual(await rows(db, CHECKS[2]), []);
      assert.deepEqual(await rows(db, CHECKS[3]), []);
    });

    it("region is readable signed out, by a customer, the owner and an admin", async () => {
      for (const [role, uid] of [["anon", null], ["authenticated", CUSTOMER], ["authenticated", EAST_COOK], ["authenticated", ADMIN]] as const) {
        const r = await as(db, role, uid, () => rows<{ region: string }>(db, "select id, region from public.kitchens where id = $1", [EAST_COOK]));
        assert.deepEqual(r.map((x) => x.region), ["east"], `${role} ${uid}`);
      }
    });

    it("each of the 5 private columns is still permission denied, owner and admin included", async () => {
      for (const [role, uid] of [["anon", null], ["authenticated", CUSTOMER], ["authenticated", EAST_COOK], ["authenticated", ADMIN]] as const) {
        for (const column of PRIVATE_COLUMNS) {
          const error = await as(db, role, uid, () => attempt(db, `select ${column} from public.kitchens`));
          assert.match(error, /permission denied/, `${role} ${uid} ${column}`);
        }
      }
    });

    it("select * still fails, signed in or out", async () => {
      for (const [role, uid] of [["anon", null], ["authenticated", EAST_COOK]] as const) {
        const error = await as(db, role, uid, () => attempt(db, "select * from public.kitchens"));
        assert.match(error, /permission denied/, role);
      }
    });

    it("re-running the updated Phase 2 Part B keeps region readable", async () => {
      await db.exec(PHASE2_B);
      const counts = await rows<{ grantee: string; count: number }>(db, CHECKS[1]);
      assert.deepEqual(counts.map((r) => [r.grantee, Number(r.count)]), [["anon", 16], ["authenticated", 16]]);
      const r = await as(db, "authenticated", CUSTOMER, () => rows<{ region: string }>(db, "select region from public.kitchens where id = $1", [EAST_COOK]));
      assert.deepEqual(r, [{ region: "east" }]);
      const error = await as(db, "authenticated", CUSTOMER, () => attempt(db, "select paynow_value from public.kitchens"));
      assert.match(error, /permission denied/);
    });
  });

  describe("set_my_ride_regions", () => {
    const setMine = (regions: string[]) => attempt(db, "select public.set_my_ride_regions($1::text[])", [arr(regions)]);

    it("is refused signed out", async () => {
      assert.match(await as(db, "anon", null, () => setMine(["north"])), /permission denied/);
      assert.match(await as(db, "authenticated", null, () => setMine(["north"])), /Sign in first/);
    });

    it("is refused for a plain customer and a cook", async () => {
      for (const uid of [CUSTOMER, EAST_COOK]) {
        const r = await as(db, "authenticated", uid, async () => ({ error: await setMine(["north"]), mine: await regionsOf(db, uid) }));
        assert.match(r.error, /Only riders and rider applicants/, uid);
        assert.deepEqual(r.mine, []);
      }
    });

    it("works for an applicant and replaces the set exactly (trimmed, lowercased, no duplicates)", async () => {
      const r = await as(db, "authenticated", APPLICANT, async () => {
        const first = await setMine(["east", "North", " north "]);
        const afterFirst = await regionsOf(db, APPLICANT);
        const second = await setMine(["West", "east"]);
        return { first, afterFirst, second, afterSecond: await regionsOf(db, APPLICANT) };
      });
      assert.deepEqual(r, { first: "", afterFirst: ["east", "north"], second: "", afterSecond: ["east", "west"] });
    });

    it("works for a rider by role, with or without an application on file", async () => {
      for (const uid of [RIDER, ROLE_ONLY_RIDER]) {
        const r = await as(db, "authenticated", uid, async () => ({ error: await setMine(["south"]), mine: await regionsOf(db, uid) }));
        assert.deepEqual(r, { error: "", mine: ["south"] }, uid);
      }
    });

    it("rejects an empty list, blanks only, NULL, and 'central', leaving the regions as they were", async () => {
      const r = await as(db, "authenticated", APPLICANT, async () => {
        await setMine(["north"]);
        return {
          empty: await setMine([]),
          blanks: await attempt(db, "select public.set_my_ride_regions(array[' ', null]::text[])"),
          nullList: await attempt(db, "select public.set_my_ride_regions(null)"),
          central: await setMine(["east", "central"]),
          mine: await regionsOf(db, APPLICANT),
        };
      });
      assert.match(r.empty, /Pick at least one region/);
      assert.match(r.blanks, /Pick at least one region/);
      assert.match(r.nullList, /Pick at least one region/);
      assert.match(r.central, /Unknown region/);
      assert.deepEqual(r.mine, ["north"]);
    });
  });

  describe("admin_set_rider_regions", () => {
    const adminSet = (rider: string | null, regions: string[]) =>
      attempt(db, "select public.admin_set_rider_regions($1::uuid, $2::text[])", [rider, arr(regions)]);

    it("is refused for anyone but an admin", async () => {
      for (const uid of [CUSTOMER, RIDER, EAST_COOK]) {
        const error = await as(db, "authenticated", uid, () => adminSet(RIDER, ["north"]));
        assert.match(error, /Only admins can change a rider's regions/, uid);
      }
      assert.match(await as(db, "anon", null, () => adminSet(RIDER, ["north"])), /permission denied/);
    });

    it("lets an admin replace a rider's or applicant's regions exactly", async () => {
      const r = await as(db, "authenticated", ADMIN, async () => {
        const a = await adminSet(RIDER, ["south", "east"]);
        const b = await adminSet(RIDER, ["west"]);
        const c = await adminSet(APPLICANT, ["north", "east"]);
        return { a, b, c, rider: await regionsOf(db, RIDER), applicant: await regionsOf(db, APPLICANT) };
      });
      assert.deepEqual(r, { a: "", b: "", c: "", rider: ["west"], applicant: ["east", "north"] });
    });

    it("applies the same checks: a real rider, at least one real region", async () => {
      const r = await as(db, "authenticated", ADMIN, async () => ({
        customer: await adminSet(CUSTOMER, ["north"]),
        nobody: await adminSet(null, ["north"]),
        empty: await adminSet(RIDER, []),
        central: await adminSet(RIDER, ["central"]),
        customerRows: await regionsOf(db, CUSTOMER),
      }));
      assert.match(r.customer, /Only riders and rider applicants/);
      assert.match(r.nobody, /Choose a rider/);
      assert.match(r.empty, /Pick at least one region/);
      assert.match(r.central, /Unknown region/);
      assert.deepEqual(r.customerRows, []);
    });
  });

  describe("rider_regions access", () => {
    before(async () => {
      // As the table owner, committed: two riders with regions.
      await db.exec(`insert into public.rider_regions (user_id, region) values
        ('${RIDER}', 'north'), ('${RIDER}', 'east'), ('${APPLICANT}', 'west')`);
    });

    it("a rider reads only their own rows; an admin reads every rider's", async () => {
      const rider = await as(db, "authenticated", RIDER, () => rows<{ user_id: string }>(db, "select user_id from public.rider_regions"));
      assert.deepEqual([...new Set(rider.map((r) => r.user_id))], [RIDER]);
      const other = await as(db, "authenticated", APPLICANT, () => regionsOf(db, RIDER));
      assert.deepEqual(other, []);
      const admin = await as(db, "authenticated", ADMIN, () => rows(db, "select user_id, region from public.rider_regions"));
      assert.equal(admin.length, 3);
      const customer = await as(db, "authenticated", CUSTOMER, () => rows(db, "select * from public.rider_regions"));
      assert.deepEqual(customer, []);
    });

    it("signed out reads nothing; nobody writes the table directly", async () => {
      assert.match(await as(db, "anon", null, () => attempt(db, "select * from public.rider_regions")), /permission denied/);
      for (const uid of [RIDER, ADMIN]) {
        const r = await as(db, "authenticated", uid, async () => ({
          insert: await attempt(db, `insert into public.rider_regions (user_id, region) values ('${uid}', 'south')`),
          update: await attempt(db, "update public.rider_regions set region = 'south'"),
          delete: await attempt(db, "delete from public.rider_regions"),
        }));
        for (const [op, error] of Object.entries(r)) assert.match(error, /permission denied/, `${uid} ${op}`);
      }
    });

    it("the shared helper behind both RPCs can't be called by app users", async () => {
      for (const [role, uid] of [["anon", null], ["authenticated", ADMIN]] as const) {
        const helper = await as(db, role, uid, () => attempt(db, `select public.replace_rider_regions('${RIDER}'::uuid, array['south'])`));
        assert.match(helper, /permission denied/, role);
      }
    });

    it("a rider's rows go when the user is deleted", async () => {
      await db.exec("begin");
      try {
        await db.query("delete from auth.users where id = $1", [RIDER]);
        assert.deepEqual(await regionsOf(db, RIDER), []);
      } finally {
        await db.exec("rollback");
      }
    });

    it("re-running Part A and Part B keeps riders' rows and an edited sector as edited", async () => {
      await db.exec("update public.postal_sector_regions set region = 'north', note = 'HQ edit' where sector = '46'");
      await db.exec(PART_A);
      await db.exec(PART_B);
      const edited = await rows(db, "select region, note from public.postal_sector_regions where sector = '46'");
      assert.deepEqual(edited, [{ region: "north", note: "HQ edit" }]);
      assert.equal(await regionOf(db, EAST_COOK), "north");
      assert.deepEqual(await regionsOf(db, RIDER), ["east", "north"]);
      await db.exec("update public.postal_sector_regions set region = 'east', note = null where sector = '46'");
      assert.equal(await regionOf(db, EAST_COOK), "east");
    });
  });

  describe("the read-only checks at the end of the file", () => {
    it("check 4 counts kitchens per region and check 5 finds no live kitchen missing its region", async () => {
      const perRegion = await rows<{ region: string | null; count: number }>(db, CHECKS[4]);
      assert.deepEqual(perRegion.map((r) => [r.region, Number(r.count)]), [["east", 1], ["north", 1], ["south", 1], ["west", 1], [null, 2]]);
      assert.deepEqual(await rows(db, CHECKS[5]), []);
    });

    it("check 8: rider_regions is SELECT-only for authenticated, nothing for anon", async () => {
      const r = await rows<{ grantee: string; privilege_type: string }>(db, CHECKS[8]);
      assert.deepEqual(r, [{ grantee: "authenticated", privilege_type: "SELECT" }]);
    });

    it("check 9: only the two RPCs are callable, and only by authenticated", async () => {
      const r = await rows<{ proname: string; rolname: string }>(db, CHECKS[9]);
      assert.deepEqual(r, [
        { proname: "admin_set_rider_regions", rolname: "authenticated" },
        { proname: "set_my_ride_regions", rolname: "authenticated" },
      ]);
    });

    it("check 10: every region function has an empty search_path, and they are all SECURITY DEFINER", async () => {
      assert.deepEqual(await rows(db, CHECKS[10]), []);
      const r = await rows<{ proname: string; prosecdef: boolean }>(
        db,
        "select proname, prosecdef from pg_proc where proname in ('set_kitchen_region', 'resync_kitchen_regions', 'replace_rider_regions', 'set_my_ride_regions', 'admin_set_rider_regions') order by proname"
      );
      assert.equal(r.length, 5);
      assert.ok(r.every((x) => x.prosecdef));
    });

    it("check 10 does catch a function without the empty search_path", async () => {
      await db.exec("begin");
      try {
        await db.exec("create or replace function public.set_my_ride_regions(p_regions text[]) returns void language sql as $$ select $$");
        assert.deepEqual(await rows(db, CHECKS[10]), [{ proname: "set_my_ride_regions" }]);
      } finally {
        await db.exec("rollback");
      }
    });

    it("check 11 counts riders per region", async () => {
      const r = await rows<{ region: string; count: number }>(db, CHECKS[11]);
      assert.deepEqual(r.map((x) => [x.region, Number(x.count)]), [["east", 1], ["north", 1], ["west", 1]]);
    });
  });
});

describe("regions SQL — missing prerequisites", () => {
  it("Part A stops cleanly when kitchens.postal_sector is missing", async () => {
    const db = await baseDb(false);
    const error = await attemptFile(db, PART_A);
    assert.match(error, /regions Part A: missing kitchens\.postal_sector\. Nothing was changed\./);
    assert.equal(await exists(db, "public.regions"), false);
    assert.equal(await exists(db, "public.postal_sector_regions"), false);
    const col = await rows(db, "select 1 from information_schema.columns where table_schema = 'public' and table_name = 'kitchens' and column_name = 'region'");
    assert.deepEqual(col, []);
    await db.close();
  });

  it("Part B stops cleanly when Part A hasn't run", async () => {
    const db = await baseDb();
    const error = await attemptFile(db, PART_B);
    assert.match(error, /regions Part B: missing regions \(run Part A first\)\. Nothing was changed\./);
    assert.equal(await exists(db, "public.rider_regions"), false);
    const fn = await rows(db, "select 1 from pg_proc where proname in ('set_my_ride_regions', 'admin_set_rider_regions', 'replace_rider_regions')");
    assert.deepEqual(fn, []);
    await db.close();
  });
});

describe("regions SQL — UNDO", () => {
  it("undoing Part B then Part A puts the database back to 15 columns, with section 29 still working", async () => {
    const db = await fullDb();
    await db.exec(UNDO_B);
    await db.exec(UNDO_A);
    for (const t of ["public.rider_regions", "public.postal_sector_regions", "public.regions"]) assert.equal(await exists(db, t), false, t);
    const counts = await rows<{ grantee: string; count: number }>(db, CHECKS[1]);
    assert.deepEqual(counts.map((r) => [r.grantee, Number(r.count)]), [["anon", 15], ["authenticated", 15]]);
    const leftovers = await rows(
      db,
      "select proname from pg_proc where proname in ('set_kitchen_region', 'resync_kitchen_regions', 'replace_rider_regions', 'set_my_ride_regions', 'admin_set_rider_regions')"
    );
    assert.deepEqual(leftovers, []);
    const sector = await as(db, "authenticated", EAST_COOK, async () => {
      await db.query("update public.kitchen_addresses set postal_code = '560123' where kitchen_id = $1", [EAST_COOK]);
      return (await rows<{ postal_sector: string }>(db, "select postal_sector from public.kitchens where id = $1", [EAST_COOK]))[0].postal_sector;
    });
    assert.equal(sector, "56");
    // Part A can be run again afterwards.
    await db.exec(PART_A);
    assert.equal(await regionOf(db, EAST_COOK), "east");
    await db.close();
  });
});

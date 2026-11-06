import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/**
 * docs/supabase-kitchen-privacy-phase2.sql, run for real (PGlite) with the
 * anon / authenticated roles, the real kitchens RLS policies and grants
 * (docs/supabase-schema.sql section 6), the real terms-acknowledgement trigger
 * (section 33), and stand-ins for Phase 1's get_order_paynow,
 * kitchen_public_locations and hero_candidates (Customer repo,
 * docs/supabase-kitchen-privacy.sql) with the same security settings.
 *
 * Run twice over: without kitchens.region (15 public columns, as before
 * docs/supabase-regions.sql) and with it (16: Part B's guarded B3 grants it).
 */

// Normalised to \n so the section markers below match on a Windows checkout.
const docs = (name: string) => readFileSync(new URL(`../../docs/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const SQL = docs("supabase-kitchen-privacy-phase2.sql");
const SCHEMA_SQL = docs("supabase-schema.sql");

function between(text: string, start: string, end: string): string {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`section not found: ${start}`);
  return text.slice(a, b);
}

const PART_A = between(SQL, "-- PART A — ADDITIVE", "-- PART B — THE LOCK");
const PART_B = between(SQL, "-- PART B — THE LOCK", "-- CHECKS AFTERWARDS");
/** The read-only check queries at the end of the file, uncommented (numbered 1–4). */
const CHECKS = SQL.slice(SQL.indexOf("-- CHECKS AFTERWARDS"))
  .split("\n")
  .filter((l) => /^-- select /.test(l))
  .map((l) => l.replace(/^-- /, ""));

// The real section 33 trigger (function + trigger), straight from the schema file.
const TERMS_TRIGGER = between(
  SCHEMA_SQL,
  "create or replace function public.stamp_kitchen_terms_acknowledgement()",
  "-- ----------------------------------------------------------------------------\n-- 34."
);

const PUBLIC_COLUMNS = [
  "id", "business_name", "category", "cuisine_type", "neighbourhood", "description", "hero_image", "is_live",
  "created_at", "updated_at", "business_uen", "postal_sector", "is_halal", "is_blocked", "live_since",
];
const PRIVATE_COLUMNS = ["paynow_type", "paynow_value", "latitude", "longitude", "acknowledged_terms_at"];

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LIVE_COOK = id(1);
const OFFLINE_COOK = id(2);
const NEW_COOK = id(3);
const ADMIN = id(400);
const CUSTOMER = id(500);
const STRANGER = id(501);
const ACCEPTED = id(601);

const schema = (withNeighbourhood = true, withRegion = false) => `
create role anon;
create role authenticated;
create schema auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;

create table public.profiles (id uuid primary key, role text not null default 'customer');
${between(SCHEMA_SQL, "create or replace function public.user_has_role(check_role text)", "drop policy if exists \"Users can read their own profile\"")}

create table public.kitchens (
  id uuid primary key,
  business_name text not null,
  category text,
  cuisine_type text,
  ${withNeighbourhood ? "neighbourhood text," : ""}
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
  postal_sector text,
  is_halal boolean not null default false,
  acknowledged_terms_at timestamptz,
  is_blocked boolean not null default false,
  live_since timestamptz${withRegion ? ", region text" : ""}
);
alter table public.kitchens enable row level security;
${between(SCHEMA_SQL, "grant select, insert, update on public.kitchens to authenticated;", "-- ----------------------------------------------------------------------------\n-- 7. MENU ITEMS")}

create table public.menu_items (id uuid primary key default gen_random_uuid(), kitchen_id uuid not null references public.kitchens(id), name text not null);
alter table public.menu_items enable row level security;
create policy "Anyone can read menu items of a live kitchen" on public.menu_items for select
  using (exists (select 1 from public.kitchens k where k.id = menu_items.kitchen_id and k.is_live = true));
grant select on public.menu_items to anon, authenticated;

create table public.orders (id uuid primary key, customer_id uuid not null, kitchen_id uuid not null references public.kitchens(id), order_status text not null);
alter table public.orders enable row level security;

-- Phase 1 (Customer repo), same security settings: a SECURITY DEFINER function
-- and two security_invoker = false views; anon on the 15 public columns only.
create function public.get_order_paynow(p_order_id uuid)
returns table (paynow_type text, paynow_value text) language sql stable security definer set search_path = public as $$
  select k.paynow_type, k.paynow_value from public.orders o join public.kitchens k on k.id = o.kitchen_id
  where o.id = p_order_id and o.customer_id = auth.uid() and o.order_status = 'accepted';
$$;
revoke all on function public.get_order_paynow(uuid) from public, anon;
grant execute on function public.get_order_paynow(uuid) to authenticated;
create view public.kitchen_public_locations with (security_invoker = false) as
  select k.id as kitchen_id, round(k.latitude::numeric, 2)::numeric(9,6) as latitude, round(k.longitude::numeric, 2)::numeric(9,6) as longitude
  from public.kitchens k where k.is_live and k.latitude is not null and k.longitude is not null;
grant select on public.kitchen_public_locations to anon, authenticated;
create view public.hero_candidates with (security_invoker = false) as
  select 'new_kitchen'::text as slide_kind, k.id as kitchen_id, k.business_name,
         round(k.latitude::numeric, 2)::numeric(9,6) as latitude, round(k.longitude::numeric, 2)::numeric(9,6) as longitude
  from public.kitchens k where k.is_live and not k.is_blocked and k.live_since is not null;
grant select on public.hero_candidates to anon, authenticated;
revoke select on public.kitchens from anon;
grant select (${PUBLIC_COLUMNS.filter((c) => withNeighbourhood || c !== "neighbourhood").concat(withRegion ? ["region"] : []).join(", ")}) on public.kitchens to anon;

-- Seed as the table owner, before the terms trigger (it would restamp the dates).
insert into public.profiles (id, role) values
  ('${LIVE_COOK}', 'cook'), ('${OFFLINE_COOK}', 'cook'), ('${NEW_COOK}', 'cook'), ('${ADMIN}', 'admin'), ('${CUSTOMER}', 'customer'), ('${STRANGER}', 'customer');
insert into public.kitchens (id, business_name, is_live, paynow_type, paynow_value, latitude, longitude, live_since, acknowledged_terms_at) values
  ('${LIVE_COOK}', 'Aunty May', true, 'mobile', '91234567', 1.345678, 103.876543, now() - interval '2 days', '2026-01-01T00:00:00Z'),
  ('${OFFLINE_COOK}', 'Closed Kitchen', false, 'uen', '201912345K', 1.300001, 103.800001, null, null);
${withRegion ? `update public.kitchens set region = case id when '${LIVE_COOK}' then 'east' else 'north' end;` : ""}
insert into public.menu_items (kitchen_id, name) values ('${LIVE_COOK}', 'Laksa'), ('${OFFLINE_COOK}', 'Hidden');
insert into public.orders (id, customer_id, kitchen_id, order_status) values ('${ACCEPTED}', '${CUSTOMER}', '${LIVE_COOK}', 'accepted');

${TERMS_TRIGGER}
`;

async function freshDb(withNeighbourhood = true, withRegion = false): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(schema(withNeighbourhood, withRegion));
  return db;
}

/** Runs fn as `role` / signed-in `uid`, inside a transaction that's always rolled back. */
async function as<T>(db: PGlite, role: "anon" | "authenticated", uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
    await db.exec(`set local role ${role}`);
    return await fn();
  } finally {
    await db.exec("rollback");
  }
}

/** The error message, or "" if the statement worked. */
async function attempt(db: PGlite, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await db.query(sql, params);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

const rows = async <T>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

describe("kitchen privacy Phase 2 SQL — Part A only (before the lock)", () => {
  let db: PGlite;
  before(async () => {
    db = await freshDb();
    await db.exec(PART_A);
  });
  after(() => db.close());

  it("changes nothing for signed-in reads yet (the app's fallback path still works)", async () => {
    const r = await as(db, "authenticated", LIVE_COOK, () => rows(db, "select paynow_value from public.kitchens where id = $1", [LIVE_COOK]));
    assert.deepEqual(r, [{ paynow_value: "91234567" }]);
  });

  it("get_my_kitchen_private works already", async () => {
    const r = await as(db, "authenticated", LIVE_COOK, () => rows(db, "select paynow_type, paynow_value from public.get_my_kitchen_private()"));
    assert.deepEqual(r, [{ paynow_type: "mobile", paynow_value: "91234567" }]);
  });
});

describe("kitchen privacy Phase 2 SQL — after Part A + Part B", () => {
  let db: PGlite;
  before(async () => {
    db = await freshDb();
    await db.exec(PART_A);
    await db.exec(PART_B);
  });
  after(() => db.close());

  it("a signed-in user gets permission denied on each of the 5 columns", async () => {
    for (const column of PRIVATE_COLUMNS) {
      const error = await as(db, "authenticated", CUSTOMER, () => attempt(db, `select ${column} from public.kitchens`));
      assert.match(error, /permission denied/, column);
    }
  });

  it("…including the owner and an admin reading the table directly", async () => {
    for (const uid of [LIVE_COOK, ADMIN]) {
      const error = await as(db, "authenticated", uid, () => attempt(db, "select paynow_value from public.kitchens where id = $1", [LIVE_COOK]));
      assert.match(error, /permission denied/);
    }
  });

  it("select * fails for a signed-in user (why the app never uses it on kitchens)", async () => {
    const error = await as(db, "authenticated", LIVE_COOK, () => attempt(db, "select * from public.kitchens"));
    assert.match(error, /permission denied/);
  });

  it("the 15 public columns still read, with RLS deciding the rows", async () => {
    const customer = await as(db, "authenticated", CUSTOMER, () => rows<{ id: string }>(db, `select ${PUBLIC_COLUMNS.join(", ")} from public.kitchens order by id`));
    assert.deepEqual(customer.map((r) => r.id), [LIVE_COOK]);
    const owner = await as(db, "authenticated", OFFLINE_COOK, () => rows<{ id: string }>(db, "select id, business_name from public.kitchens where id = $1", [OFFLINE_COOK]));
    assert.equal(owner.length, 1); // own offline kitchen, via "Cooks can read their own kitchen"
  });

  it("grants authenticated exactly the 15 public columns, and keeps INSERT and UPDATE", async () => {
    const cols = await rows<{ column_name: string }>(db, CHECKS[0]);
    assert.deepEqual(cols.map((r) => r.column_name).sort(), [...PUBLIC_COLUMNS].sort());
    const privileges = await rows<{ privilege_type: string }>(db, CHECKS[1]);
    assert.deepEqual(privileges.map((r) => r.privilege_type), ["INSERT", "UPDATE"]);
  });

  it("check queries 3 and 4 find no policy or caller-rights view reading the 5 columns", async () => {
    assert.deepEqual(await rows(db, CHECKS[2]), []);
    assert.deepEqual(await rows(db, CHECKS[3]), []);
  });

  it("check queries 3 and 4 do catch a policy or caller-rights view that reads one", async () => {
    await db.exec("begin");
    try {
      await db.exec(`create policy "leaky" on public.kitchens for select using (paynow_value is not null);
        create view public.leaky_view with (security_invoker = true) as select id, latitude from public.kitchens;`);
      assert.deepEqual((await rows<{ policyname: string }>(db, CHECKS[2])).map((r) => r.policyname), ["leaky"]);
      assert.deepEqual((await rows<{ view_name: string }>(db, CHECKS[3])).map((r) => r.view_name), ["leaky_view"]);
    } finally {
      await db.exec("rollback");
    }
  });

  it("the menu stays readable: the menu_items policy reads kitchens.is_live as the caller", async () => {
    const r = await as(db, "authenticated", CUSTOMER, () => rows<{ name: string }>(db, "select name from public.menu_items"));
    assert.deepEqual(r.map((x) => x.name), ["Laksa"]);
  });

  describe("the owner saving (what saveKitchenRow sends)", () => {
    it("INSERTs a new kitchen with PayNow and the terms tick, then UPDATEs PayNow, never reading them back", async () => {
      const result = await as(db, "authenticated", NEW_COOK, async () => {
        // First save: plain INSERT, nothing returned (supabase-js insert without .select()).
        const insertError = await attempt(
          db,
          "insert into public.kitchens (id, business_name, paynow_type, paynow_value, acknowledged_terms_at, is_live) values ($1, 'New Kitchen', 'mobile', '81111111', '2000-01-01T00:00:00Z', true)",
          [NEW_COOK]
        );
        // PostgREST may return the primary key; id is a public column.
        const returningId = await attempt(db, "update public.kitchens set description = 'x' where id = $1 returning id", [NEW_COOK]);
        // Later save: plain UPDATE of the private columns.
        const updateError = await attempt(
          db,
          "update public.kitchens set paynow_type = 'uen', paynow_value = '202012345K', acknowledged_terms_at = now() where id = $1",
          [NEW_COOK]
        );
        const mine = await rows<{ paynow_type: string; paynow_value: string; acknowledged_terms_at: Date }>(
          db,
          "select * from public.get_my_kitchen_private()"
        );
        return { insertError, returningId, updateError, mine };
      });
      assert.equal(result.insertError, "");
      assert.equal(result.returningId, "");
      assert.equal(result.updateError, "");
      assert.equal(result.mine.length, 1);
      assert.equal(result.mine[0].paynow_type, "uen");
      assert.equal(result.mine[0].paynow_value, "202012345K");
      // The section 33 trigger stamped the server's time, not the client's 2000-01-01.
      assert.ok(new Date(result.mine[0].acknowledged_terms_at).getFullYear() > 2000);
    });

    it("still refuses a first INSERT without the terms tick (section 33 trigger unchanged)", async () => {
      const error = await as(db, "authenticated", NEW_COOK, () =>
        attempt(db, "insert into public.kitchens (id, business_name) values ($1, 'No Tick')", [NEW_COOK])
      );
      assert.match(error, /acknowledge the Kopi Boy partner terms/);
    });

    it("keeps the original terms date on an update (trigger reads OLD without the caller's SELECT)", async () => {
      const r = await as(db, "authenticated", LIVE_COOK, async () => {
        await db.query("update public.kitchens set acknowledged_terms_at = now(), paynow_value = '99999999' where id = $1", [LIVE_COOK]);
        return rows<{ acknowledged_terms_at: Date; paynow_value: string }>(db, "select acknowledged_terms_at, paynow_value from public.get_my_kitchen_private()");
      });
      assert.equal(new Date(r[0].acknowledged_terms_at).toISOString(), "2026-01-01T00:00:00.000Z");
      assert.equal(r[0].paynow_value, "99999999");
    });

    it("an upsert that sets a private column is refused (why the app stopped using upsert)", async () => {
      const error = await as(db, "authenticated", LIVE_COOK, () =>
        attempt(
          db,
          "insert into public.kitchens (id, business_name, paynow_value, acknowledged_terms_at) values ($1, 'Aunty May', '90000000', now()) on conflict (id) do update set business_name = excluded.business_name, paynow_value = excluded.paynow_value, acknowledged_terms_at = excluded.acknowledged_terms_at",
          [LIVE_COOK]
        )
      );
      assert.match(error, /permission denied/);
    });

    it("returning a private column after a write is refused (why the app adds no .select())", async () => {
      const error = await as(db, "authenticated", LIVE_COOK, () =>
        attempt(db, "update public.kitchens set description = 'x' where id = $1 returning paynow_value", [LIVE_COOK])
      );
      assert.match(error, /permission denied/);
    });

    it("can't write someone else's kitchen (RLS unchanged)", async () => {
      const affected = await as(db, "authenticated", STRANGER, async () =>
        (await db.query("update public.kitchens set paynow_value = '00000000' where id = $1", [LIVE_COOK])).affectedRows
      );
      assert.equal(affected, 0);
    });
  });

  describe("get_my_kitchen_private", () => {
    it("returns only the caller's own kitchen", async () => {
      const r = await as(db, "authenticated", OFFLINE_COOK, () => rows(db, "select paynow_type, paynow_value from public.get_my_kitchen_private()"));
      assert.deepEqual(r, [{ paynow_type: "uen", paynow_value: "201912345K" }]);
    });

    it("returns nothing for a signed-in user without a kitchen", async () => {
      for (const uid of [CUSTOMER, ADMIN]) {
        assert.deepEqual(await as(db, "authenticated", uid, () => rows(db, "select * from public.get_my_kitchen_private()")), []);
      }
    });

    it("can't be called signed out", async () => {
      const error = await as(db, "anon", null, () => attempt(db, "select * from public.get_my_kitchen_private()"));
      assert.match(error, /permission denied/);
    });
  });

  describe("admin_get_kitchen_private", () => {
    it("is refused for a non-admin, cook included", async () => {
      for (const uid of [CUSTOMER, LIVE_COOK]) {
        const error = await as(db, "authenticated", uid, () => attempt(db, "select * from public.admin_get_kitchen_private($1)", [LIVE_COOK]));
        assert.match(error, /Only admins can read kitchen private details/);
      }
      const anon = await as(db, "anon", null, () => attempt(db, "select * from public.admin_get_kitchen_private()"));
      assert.match(anon, /permission denied/);
    });

    it("gives an admin one kitchen, or all of them", async () => {
      const one = await as(db, "authenticated", ADMIN, () =>
        rows<{ paynow_value: string; latitude: string }>(db, "select paynow_value, latitude::text from public.admin_get_kitchen_private($1)", [LIVE_COOK])
      );
      assert.deepEqual(one, [{ paynow_value: "91234567", latitude: "1.345678" }]);
      const all = await as(db, "authenticated", ADMIN, () => rows(db, "select kitchen_id from public.admin_get_kitchen_private()"));
      assert.equal(all.length, 2);
    });
  });

  describe("Phase 1 objects keep working", () => {
    it("get_order_paynow gives the customer of an accepted order the PayNow", async () => {
      const r = await as(db, "authenticated", CUSTOMER, () => rows(db, "select * from public.get_order_paynow($1)", [ACCEPTED]));
      assert.deepEqual(r, [{ paynow_type: "mobile", paynow_value: "91234567" }]);
      assert.deepEqual(await as(db, "authenticated", STRANGER, () => rows(db, "select * from public.get_order_paynow($1)", [ACCEPTED])), []);
    });

    it("kitchen_public_locations and hero_candidates read rounded coordinates, signed in or out", async () => {
      for (const [role, uid] of [["authenticated", CUSTOMER], ["anon", null]] as const) {
        const loc = await as(db, role, uid, () => rows(db, "select kitchen_id, latitude::text, longitude::text from public.kitchen_public_locations"));
        assert.deepEqual(loc, [{ kitchen_id: LIVE_COOK, latitude: "1.350000", longitude: "103.880000" }]);
        const hero = await as(db, role, uid, () => rows(db, "select kitchen_id, latitude::text from public.hero_candidates"));
        assert.deepEqual(hero, [{ kitchen_id: LIVE_COOK, latitude: "1.350000" }]);
      }
    });

    it("anon still can't read the 5 columns (Phase 1 unchanged)", async () => {
      const error = await as(db, "anon", null, () => attempt(db, "select paynow_value from public.kitchens"));
      assert.match(error, /permission denied/);
    });
  });

  it("is safe to re-run (Part A and Part B again)", async () => {
    await db.exec(PART_A);
    await db.exec(PART_B);
    const cols = await rows<{ column_name: string }>(db, CHECKS[0]);
    assert.equal(cols.length, 15);
    const error = await as(db, "authenticated", CUSTOMER, () => attempt(db, "select paynow_value from public.kitchens"));
    assert.match(error, /permission denied/);
  });

  it("the undo line puts the old table-wide read back", async () => {
    await db.exec("begin; grant select on public.kitchens to authenticated;");
    const r = await as_inTx(db, CUSTOMER, () => rows(db, "select paynow_value from public.kitchens"));
    await db.exec("rollback");
    assert.deepEqual(r, [{ paynow_value: "91234567" }]);
  });
});

/** Like `as`, but inside a transaction the caller already opened. */
async function as_inTx<T>(db: PGlite, uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
  await db.exec("set local role authenticated");
  const out = await fn();
  await db.exec("reset role");
  return out;
}

describe("kitchen privacy Phase 2 SQL — with kitchens.region (after supabase-regions.sql)", () => {
  let db: PGlite;
  before(async () => {
    db = await freshDb(true, true);
    await db.exec(PART_A);
    await db.exec(PART_B);
  });
  after(() => db.close());

  const SIGNED_IN = [["owner", LIVE_COOK], ["admin", ADMIN], ["customer", CUSTOMER]] as const;

  it("grants authenticated exactly the 15 public columns plus region (16)", async () => {
    const cols = await rows<{ column_name: string }>(db, CHECKS[0]);
    assert.equal(cols.length, 16);
    assert.deepEqual(cols.map((r) => r.column_name).sort(), [...PUBLIC_COLUMNS, "region"].sort());
    const privileges = await rows<{ privilege_type: string }>(db, CHECKS[1]);
    assert.deepEqual(privileges.map((r) => r.privilege_type), ["INSERT", "UPDATE"]);
  });

  it("region is readable by the owner, an admin and a customer", async () => {
    for (const [who, uid] of SIGNED_IN) {
      const r = await as(db, "authenticated", uid, () => rows(db, "select id, region from public.kitchens where id = $1", [LIVE_COOK]));
      assert.deepEqual(r, [{ id: LIVE_COOK, region: "east" }], who);
    }
    const own = await as(db, "authenticated", OFFLINE_COOK, () => rows(db, "select region from public.kitchens where id = $1", [OFFLINE_COOK]));
    assert.deepEqual(own, [{ region: "north" }]);
  });

  it("the 5 private columns are still permission denied for the owner, an admin and a customer", async () => {
    for (const [who, uid] of SIGNED_IN) {
      for (const column of PRIVATE_COLUMNS) {
        const error = await as(db, "authenticated", uid, () => attempt(db, `select ${column} from public.kitchens`));
        assert.match(error, /permission denied/, `${who} ${column}`);
      }
    }
  });

  it("select * still fails", async () => {
    for (const [who, uid] of SIGNED_IN) {
      const error = await as(db, "authenticated", uid, () => attempt(db, "select * from public.kitchens"));
      assert.match(error, /permission denied/, who);
    }
  });

  it("a re-run of Part B keeps region readable (and the 5 columns hidden)", async () => {
    await db.exec(PART_B);
    await db.exec(PART_B);
    const cols = await rows<{ column_name: string }>(db, CHECKS[0]);
    assert.equal(cols.length, 16);
    assert.ok(cols.some((c) => c.column_name === "region"));
    const r = await as(db, "authenticated", CUSTOMER, () => rows(db, "select region from public.kitchens where id = $1", [LIVE_COOK]));
    assert.deepEqual(r, [{ region: "east" }]);
    const error = await as(db, "authenticated", CUSTOMER, () => attempt(db, "select paynow_value from public.kitchens"));
    assert.match(error, /permission denied/);
  });
});

describe("kitchen privacy Phase 2 SQL — Part B on a database missing a column", () => {
  it("stops before changing anything", async () => {
    const db = await freshDb(false);
    await db.exec(PART_A);
    let message = "";
    try {
      await db.exec(PART_B);
    } catch (e) {
      message = (e as Error).message;
    }
    await db.exec("rollback");
    assert.match(message, /kitchen_privacy_phase2: missing kitchens column\(s\): neighbourhood/);
    const r = await as(db, "authenticated", CUSTOMER, () => rows(db, "select paynow_value from public.kitchens"));
    assert.deepEqual(r, [{ paynow_value: "91234567" }]);
    await db.close();
  });
});

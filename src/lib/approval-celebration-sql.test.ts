import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/**
 * docs/supabase-approval-celebration.sql, run for real (PGlite) on top of the
 * real profiles table, its RLS policies, grant and the
 * protect_profile_privileges trigger (schema sections 1 and 5), and the real
 * rider_applications table (section 3).
 */

// Normalised to \n so the section markers below match on a Windows checkout.
const docs = (name: string) => readFileSync(new URL(`../../docs/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const SQL = docs("supabase-approval-celebration.sql");
const SCHEMA_SQL = docs("supabase-schema.sql");

function between(text: string, start: string, end: string): string {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`section not found: ${start}`);
  return text.slice(a, b);
}

const RULE = "-- ----------------------------------------------------------------------------\n";
const SECTION_1 = between(SCHEMA_SQL, "create table if not exists public.profiles (", RULE + "-- 2. COOK APPLICATIONS");
const SECTION_3 = between(SCHEMA_SQL, "create table if not exists public.rider_applications (", RULE + "-- 4. AUTO-CREATE");
const SECTION_5 = between(SCHEMA_SQL, "create or replace function public.protect_profile_privileges()", "\n\n\n");

/** The commented-out testing step at the end of the file, uncommented. */
const TEST_RESET = between(SQL, "-- TESTING:", "-- UNDO")
  .split("\n")
  .find((l) => l.startsWith("-- update "))!
  .replace(/^-- /, "")
  .replace("your test cook name", "Test Cook");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SET_UP_COOK = id(1); // cook with a saved kitchen
const NEW_COOK = id(2); // approved cook, no kitchen yet
const OTHER_COOK = id(3);
const RIDER = id(4); // rider role
const UNPROMOTED_RIDER = id(5); // still 'customer', rider application approved
const RIDER_APPLICANT = id(6); // still 'customer', rider application pending
const CUSTOMER = id(7);
const ALL = [SET_UP_COOK, NEW_COOK, OTHER_COOK, RIDER, UNPROMOTED_RIDER, RIDER_APPLICANT, CUSTOMER];

/** Every profile's flag after a fresh run of the file. */
const AFTER_FIRST_RUN = {
  [SET_UP_COOK]: true,
  [NEW_COOK]: false,
  [OTHER_COOK]: false,
  [RIDER]: true,
  [UNPROMOTED_RIDER]: true,
  [RIDER_APPLICANT]: false,
  [CUSTOMER]: false,
};

/** The file as first shipped (cooks only, no rider backfill), for "ran the old one first". */
const COOKS_ONLY_SQL = `
alter table public.profiles add column if not exists approval_celebrated boolean not null default false;
update public.profiles p set approval_celebrated = true
 where not p.approval_celebrated and exists (select 1 from public.kitchens k where k.id = p.id);`;

async function db(firstRun: string | null = SQL): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(`
create role anon;
create role authenticated;
create schema auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
create table auth.users (id uuid primary key);
${SECTION_1}
${SECTION_3}
${SECTION_5}
create table public.kitchens (id uuid primary key references public.profiles(id) on delete cascade, business_name text not null);

insert into auth.users (id) values ${ALL.map((u) => `('${u}')`).join(", ")};
insert into public.profiles (id, role, full_name) values
  ('${SET_UP_COOK}', 'cook', 'Set Up Cook'), ('${NEW_COOK}', 'cook', 'Test Cook'),
  ('${OTHER_COOK}', 'cook', 'Other Cook'), ('${RIDER}', 'rider', 'Rider'),
  ('${UNPROMOTED_RIDER}', 'customer', 'Unpromoted Rider'), ('${RIDER_APPLICANT}', 'customer', 'Rider Applicant'),
  ('${CUSTOMER}', 'customer', 'Customer');
insert into public.kitchens (id, business_name) values ('${SET_UP_COOK}', 'Kopi Kitchen');
insert into public.rider_applications (user_id, vehicle_type, status) values
  ('${RIDER}', 'Bicycle', 'approved'), ('${UNPROMOTED_RIDER}', 'Motorcycle', 'approved'),
  ('${RIDER_APPLICANT}', 'Bicycle', 'pending');
`);
  if (firstRun) await pg.exec(firstRun);
  return pg;
}

async function celebrated(pg: PGlite): Promise<Record<string, boolean>> {
  const { rows } = await pg.query<{ id: string; approval_celebrated: boolean }>("select id, approval_celebrated from public.profiles");
  return Object.fromEntries(rows.map((r) => [r.id, r.approval_celebrated]));
}

/** Runs fn as a signed-in user, inside a transaction that's always rolled back. */
async function asUser<T>(pg: PGlite, uid: string, fn: () => Promise<T>): Promise<T> {
  await pg.exec("begin");
  try {
    await pg.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    await pg.exec("set local role authenticated");
    return await fn();
  } finally {
    await pg.exec("rollback");
  }
}

describe("docs/supabase-approval-celebration.sql", () => {
  it("adds a not-null column defaulting to false", async () => {
    const pg = await db();
    const { rows } = await pg.query<{ is_nullable: string; column_default: string }>(
      "select is_nullable, column_default from information_schema.columns where table_name = 'profiles' and column_name = 'approval_celebrated'",
    );
    assert.deepEqual(rows, [{ is_nullable: "NO", column_default: "false" }]);
  });

  it("backfills cooks with a kitchen and every existing rider, promoted or not, and no one else", async () => {
    const pg = await db();
    assert.deepEqual(await celebrated(pg), AFTER_FIRST_RUN);
  });

  it("is safe to re-run, leaves riders approved since then their celebration, and never undoes a reset", async () => {
    const pg = await db();
    // After the first run: the applicant gets approved and promoted, a rider is reset for testing.
    await pg.exec(`update public.rider_applications set status = 'approved' where user_id = '${RIDER_APPLICANT}'`);
    await pg.exec(`update public.profiles set role = 'rider' where id = '${RIDER_APPLICANT}'`);
    await pg.exec(`update public.profiles set approval_celebrated = false where id = '${RIDER}'`);
    await pg.exec(SQL);
    assert.deepEqual(await celebrated(pg), { ...AFTER_FIRST_RUN, [RIDER]: false });
  });

  it("still backfills riders when the earlier cooks-only version was run first", async () => {
    const pg = await db(COOKS_ONLY_SQL);
    assert.equal((await celebrated(pg))[RIDER], false);
    await pg.exec(SQL);
    assert.deepEqual(await celebrated(pg), AFTER_FIRST_RUN);
  });

  it("records the one-time rider backfill in the column comment", async () => {
    const pg = await db();
    const { rows } = await pg.query<{ c: string }>(
      "select col_description('public.profiles'::regclass, attnum) as c from pg_attribute where attrelid = 'public.profiles'::regclass and attname = 'approval_celebrated'",
    );
    assert.match(rows[0].c, /\[riders backfilled\]$/);
  });

  it("lets a signed-in cook mark their own celebration as seen", async () => {
    const pg = await db();
    const after = await asUser(pg, NEW_COOK, async () => {
      await pg.query("update public.profiles set approval_celebrated = true where id = $1", [NEW_COOK]);
      return pg.query<{ approval_celebrated: boolean }>("select approval_celebrated from public.profiles where id = $1", [NEW_COOK]);
    });
    assert.equal(after.rows[0].approval_celebrated, true);
  });

  it("doesn't let a cook change someone else's flag, or their own role", async () => {
    const pg = await db();
    await asUser(pg, NEW_COOK, async () => {
      const other = await pg.query("update public.profiles set approval_celebrated = true where id = $1", [OTHER_COOK]);
      assert.equal(other.affectedRows, 0);
      await pg.query("update public.profiles set approval_celebrated = true, role = 'admin' where id = $1", [NEW_COOK]);
      const { rows } = await pg.query<{ role: string; approval_celebrated: boolean }>(
        "select role, approval_celebrated from public.profiles where id = $1",
        [NEW_COOK],
      );
      assert.deepEqual(rows, [{ role: "cook", approval_celebrated: true }]);
    });
  });

  it("the testing step resets one cook's celebration", async () => {
    const pg = await db();
    await pg.exec(`update public.profiles set approval_celebrated = true`);
    await pg.exec(TEST_RESET);
    assert.deepEqual(await celebrated(pg), { ...Object.fromEntries(ALL.map((u) => [u, true])), [NEW_COOK]: false });
  });
});

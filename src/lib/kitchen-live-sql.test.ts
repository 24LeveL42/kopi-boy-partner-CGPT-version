import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/**
 * docs/supabase-kitchen-live.sql, run for real (PGlite) on top of the real
 * profiles table, its RLS policies, grant and the protect_profile_privileges
 * trigger (schema sections 1 and 5).
 */

// Normalised to \n so the section markers below match on a Windows checkout.
const docs = (name: string) => readFileSync(new URL(`../../docs/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const SQL = docs("supabase-kitchen-live.sql");
const SCHEMA_SQL = docs("supabase-schema.sql");

function between(text: string, start: string, end: string): string {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`section not found: ${start}`);
  return text.slice(a, b);
}

const RULE = "-- ----------------------------------------------------------------------------\n";
const SECTION_1 = between(SCHEMA_SQL, "create table if not exists public.profiles (", RULE + "-- 2. COOK APPLICATIONS");
const SECTION_5 = between(SCHEMA_SQL, "create or replace function public.protect_profile_privileges()", "\n\n\n");

/** The commented-out testing step at the end of the file, uncommented. */
const TEST_RESET = between(SQL, "-- TESTING:", "-- UNDO")
  .split("\n")
  .find((l) => l.startsWith("-- update "))!
  .replace(/^-- /, "")
  .replace("your test cook name", "Test Cook");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LIVE_COOK = id(1); // has a saved kitchen
const TEST_COOK = id(2); // has a saved kitchen, used for the reset
const NEW_COOK = id(3); // approved, no kitchen yet
const RIDER = id(4);
const ALL = [LIVE_COOK, TEST_COOK, NEW_COOK, RIDER];

const AFTER_FIRST_RUN = { [LIVE_COOK]: true, [TEST_COOK]: true, [NEW_COOK]: false, [RIDER]: false };

async function db(): Promise<PGlite> {
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
${SECTION_5}
create table public.kitchens (id uuid primary key references public.profiles(id) on delete cascade, business_name text not null);

insert into auth.users (id) values ${ALL.map((u) => `('${u}')`).join(", ")};
insert into public.profiles (id, role, full_name) values
  ('${LIVE_COOK}', 'cook', 'Live Cook'), ('${TEST_COOK}', 'cook', 'Test Cook'),
  ('${NEW_COOK}', 'cook', 'New Cook'), ('${RIDER}', 'rider', 'Rider');
insert into public.kitchens (id, business_name) values ('${LIVE_COOK}', 'Kopi Kitchen'), ('${TEST_COOK}', 'Test Kitchen');
`);
  await pg.exec(SQL);
  return pg;
}

async function seen(pg: PGlite): Promise<Record<string, boolean>> {
  const { rows } = await pg.query<{ id: string; kitchen_live_seen: boolean }>("select id, kitchen_live_seen from public.profiles");
  return Object.fromEntries(rows.map((r) => [r.id, r.kitchen_live_seen]));
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

describe("docs/supabase-kitchen-live.sql", () => {
  it("adds a not-null column defaulting to false", async () => {
    const pg = await db();
    const { rows } = await pg.query<{ is_nullable: string; column_default: string }>(
      "select is_nullable, column_default from information_schema.columns where table_name = 'profiles' and column_name = 'kitchen_live_seen'",
    );
    assert.deepEqual(rows, [{ is_nullable: "NO", column_default: "false" }]);
  });

  it("backfills every cook who already has a saved kitchen, and no one else", async () => {
    const pg = await db();
    assert.deepEqual(await seen(pg), AFTER_FIRST_RUN);
  });

  it("is safe to re-run: a cook who saved their first kitchen since keeps the pop-up, and a reset stays reset", async () => {
    const pg = await db();
    await pg.exec(`insert into public.kitchens (id, business_name) values ('${NEW_COOK}', 'New Kitchen')`);
    await pg.exec(`update public.profiles set kitchen_live_seen = false where id = '${TEST_COOK}'`);
    await pg.exec(SQL);
    assert.deepEqual(await seen(pg), { ...AFTER_FIRST_RUN, [TEST_COOK]: false });
  });

  it("records the one-time backfill in the column comment", async () => {
    const pg = await db();
    const { rows } = await pg.query<{ c: string }>(
      "select col_description('public.profiles'::regclass, attnum) as c from pg_attribute where attrelid = 'public.profiles'::regclass and attname = 'kitchen_live_seen'",
    );
    assert.match(rows[0].c, /\[kitchens backfilled\]$/);
  });

  it("lets a signed-in cook mark their own pop-up as seen, but not someone else's, nor change their role", async () => {
    const pg = await db();
    await asUser(pg, NEW_COOK, async () => {
      const other = await pg.query("update public.profiles set kitchen_live_seen = false where id = $1", [LIVE_COOK]);
      assert.equal(other.affectedRows, 0);
      await pg.query("update public.profiles set kitchen_live_seen = true, role = 'admin' where id = $1", [NEW_COOK]);
      const { rows } = await pg.query<{ role: string; kitchen_live_seen: boolean }>(
        "select role, kitchen_live_seen from public.profiles where id = $1",
        [NEW_COOK],
      );
      assert.deepEqual(rows, [{ role: "cook", kitchen_live_seen: true }]);
    });
  });

  it("the testing step resets one cook's pop-up", async () => {
    const pg = await db();
    await pg.exec(TEST_RESET);
    assert.deepEqual(await seen(pg), { ...AFTER_FIRST_RUN, [TEST_COOK]: false });
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/**
 * docs/supabase-registration-tracking.sql and docs/supabase-paynow-mobile.sql,
 * run for real (PGlite) on top of the real profiles table + user_has_role and
 * the real cook_applications table, policies and insert triggers.
 */

const docs = (name: string) => readFileSync(new URL(`../../docs/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const SCHEMA_SQL = docs("supabase-schema.sql");
const TRACKING_SQL = docs("supabase-registration-tracking.sql");
const PAYNOW_SQL = docs("supabase-paynow-mobile.sql");

function between(text: string, start: string, end: string): string {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`section not found: ${start}`);
  return text.slice(a, b);
}

const RULE = "-- ----------------------------------------------------------------------------\n";
const SECTION_1 = between(SCHEMA_SQL, "create table if not exists public.profiles (", RULE + "-- 2. COOK APPLICATIONS");
const SECTION_2 = between(SCHEMA_SQL, "create table if not exists public.cook_applications (", RULE + "-- 3. RIDER APPLICATIONS");
const SECTION_26 = between(SCHEMA_SQL, "alter table public.cook_applications add column if not exists business_uen text;", RULE + "-- 27.");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = id(1);
const APPLICANT = id(2);
const OLD_APPLICANT = id(3);
const SESSION = id(100);

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
${SECTION_2}
${SECTION_26}
alter table public.cook_applications add column if not exists business_address text;
alter table public.cook_applications add column if not exists postal_code text;
-- Supabase's default: new public tables are fully granted to anon/authenticated.
alter default privileges in schema public grant all on tables to anon, authenticated;
insert into auth.users (id) values ('${ADMIN}'), ('${APPLICANT}'), ('${OLD_APPLICANT}');
insert into public.profiles (id, role) values ('${ADMIN}', 'admin'), ('${APPLICANT}', 'customer'), ('${OLD_APPLICANT}', 'customer');
-- An application from before this change: free-text paynow_uen, a description.
insert into public.cook_applications (user_id, business_name, business_type, description, paynow_uen)
  values ('${OLD_APPLICANT}', 'Old Kitchen', 'Home Cook', 'Nasi lemak', 'whatever they typed');
`);
  await pg.exec(TRACKING_SQL);
  await pg.exec(PAYNOW_SQL);
  return pg;
}

/** Runs fn as anon (uid null) or a signed-in user, in a transaction that's always rolled back. */
async function as<T>(pg: PGlite, who: "anon" | string, fn: () => Promise<T>): Promise<T> {
  await pg.exec("begin");
  try {
    if (who !== "anon") await pg.query("select set_config('request.jwt.claim.sub', $1, true)", [who]);
    await pg.exec(`set local role ${who === "anon" ? "anon" : "authenticated"}`);
    return await fn();
  } finally {
    await pg.exec("rollback");
  }
}

const log = (pg: PGlite, events: unknown, session = SESSION, isTest = false) =>
  pg.query("select public.log_registration_events($1, 'cook', $2, $3::jsonb)", [session, isTest, JSON.stringify(events)]);

const count = async (pg: PGlite, where = "true") =>
  Number((await pg.query<{ n: string }>(`select count(*)::text as n from public.registration_events where ${where}`)).rows[0].n);

describe("docs/supabase-registration-tracking.sql", () => {
  it("lets an anonymous visitor log events, de-duplicated", async () => {
    const pg = await db();
    await pg.exec("begin");
    await pg.exec("set local role anon");
    await log(pg, [{ event: "page_view" }, { event: "form_start" }, { event: "field_reached", field: "full_name", step: 1 }]);
    await log(pg, [{ event: "page_view" }, { event: "field_reached", field: "full_name", step: 1 }]);
    await pg.exec("commit");
    await pg.exec("reset role");
    assert.equal(await count(pg), 3);
  });

  it("never lets anon or a normal signed-in user read, insert, change or delete events directly", async () => {
    const pg = await db();
    await log(pg, [{ event: "page_view" }]);
    // anon has no privilege at all; authenticated has SELECT (for admins), which RLS narrows to nothing.
    await as(pg, "anon", async () => {
      await assert.rejects(pg.query("select * from public.registration_events"), /permission denied/);
    });
    await as(pg, APPLICANT, async () => {
      assert.equal((await pg.query("select * from public.registration_events")).rows.length, 0);
    });
    for (const who of ["anon", APPLICANT]) {
      for (const sql of [
        `insert into public.registration_events (session_id, event_type) values ('${SESSION}', 'page_view')`,
        "update public.registration_events set is_test = true",
        "delete from public.registration_events",
      ]) {
        await as(pg, who, async () => {
          await assert.rejects(pg.query(sql), /permission denied/, `${who}: ${sql}`);
        });
      }
    }
  });

  it("lets a signed-in non-admin see zero rows, and an admin see them all", async () => {
    const pg = await db();
    await log(pg, [{ event: "page_view" }, { event: "submit_success" }]);
    const userRows = await as(pg, APPLICANT, async () => (await pg.query("select * from public.registration_events")).rows);
    assert.equal(userRows.length, 0);
    const adminRows = await as(pg, ADMIN, async () => (await pg.query("select * from public.registration_events")).rows);
    assert.equal(adminRows.length, 2);
  });

  it("silently drops anything not on the fixed lists, so typed text can't be stored", async () => {
    const pg = await db();
    await log(pg, [
      { event: "field_reached", field: "Tan Wei Ming" },
      { event: "validation_error", field: "postal_code", code: "91234567" },
      { event: "drop table" },
      "not an object",
      { event: "validation_error", field: "postal_code", code: "invalid_postal_code", step: 7 },
      { event: "field_reached", field: "full_name", step: 999 },
    ]);
    const { rows } = await pg.query<{ event_type: string; field: string; error_code: string; step: number | null }>(
      "select event_type, field, error_code, step from public.registration_events order by id"
    );
    assert.deepEqual(rows, [
      { event_type: "validation_error", field: "postal_code", error_code: "invalid_postal_code", step: 7 },
      { event_type: "field_reached", field: "full_name", error_code: "", step: null },
    ]);
  });

  it("ignores oversized batches and caps a session at 60 rows", async () => {
    const pg = await db();
    const big = Array.from({ length: 21 }, () => ({ event: "page_view" }));
    await log(pg, big);
    assert.equal(await count(pg), 0);
    // 4 calls × 20 distinct rows (80 offered); the 4th is refused because 60 are already there.
    const codes = ["", "required", "invalid_format", "invalid_postal_code", "invalid_business_uen", "paynow_missing", "invalid_mobile", "invalid_uen"];
    const fields = ["full_name", "contact_number", "business_name", "business_type", "business_uen",
      "business_address", "postal_code", "paynow_mobile", "paynow_uen", "privacy_ack"];
    let batch: unknown[] = [];
    for (const code of codes) for (const field of fields) {
      batch.push({ event: "validation_error", field, code });
      if (batch.length === 20) {
        await log(pg, batch);
        batch = [];
      }
    }
    assert.equal(await count(pg), 60);
  });

  it("marks test sessions, and anything an admin sends, as test", async () => {
    const pg = await db();
    await log(pg, [{ event: "page_view" }], id(101), true);
    await pg.exec("begin");
    await pg.query("select set_config('request.jwt.claim.sub', $1, true)", [ADMIN]);
    await pg.exec("set local role authenticated");
    await log(pg, [{ event: "page_view" }], id(102), false);
    await pg.exec("commit");
    await pg.exec("reset role");
    await log(pg, [{ event: "page_view" }], id(103), false);
    assert.equal(await count(pg, "is_test"), 2);
    assert.equal(await count(pg, "not is_test"), 1);
  });

  it("stores no user id, IP or free text column", async () => {
    const pg = await db();
    const { rows } = await pg.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'registration_events' order by ordinal_position"
    );
    assert.deepEqual(rows.map((r) => r.column_name), ["id", "session_id", "form", "event_type", "field", "step", "error_code", "is_test", "created_at"]);
  });

  it("is safe to run twice", async () => {
    const pg = await db();
    await log(pg, [{ event: "page_view" }]);
    await pg.exec(TRACKING_SQL);
    assert.equal(await count(pg), 1);
  });
});

describe("docs/supabase-paynow-mobile.sql", () => {
  const apply = (pg: PGlite, fields: Record<string, string | null>) =>
    as(pg, APPLICANT, async () => {
      const cols = ["user_id", "business_name", "business_type", ...Object.keys(fields)];
      const vals = [APPLICANT, "New Kitchen", "Home Cook", ...Object.values(fields)];
      const { rows } = await pg.query<{ paynow_mobile: string | null; paynow_uen: string | null }>(
        `insert into public.cook_applications (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning paynow_mobile, paynow_uen`,
        vals
      );
      return rows[0];
    });

  it("adds a nullable column and leaves existing applications exactly as they were", async () => {
    const pg = await db();
    const { rows } = await pg.query<{ description: string; paynow_uen: string; paynow_mobile: string | null }>(
      `select description, paynow_uen, paynow_mobile from public.cook_applications where user_id = '${OLD_APPLICANT}'`
    );
    assert.deepEqual(rows, [{ description: "Nasi lemak", paynow_uen: "whatever they typed", paynow_mobile: null }]);
  });

  it("lets an applicant submit with a mobile number only, normalised to 8 digits", async () => {
    const pg = await db();
    assert.deepEqual(await apply(pg, { paynow_mobile: "+65 9123-4567" }), { paynow_mobile: "91234567", paynow_uen: null });
  });

  it("lets an applicant submit with a UEN only, or both, and no description", async () => {
    const pg = await db();
    assert.deepEqual(await apply(pg, { paynow_uen: " 53123456X " }), { paynow_mobile: null, paynow_uen: "53123456X" });
    assert.deepEqual(await apply(pg, { paynow_uen: "T24LL1234A", paynow_mobile: "81234567" }), { paynow_mobile: "81234567", paynow_uen: "T24LL1234A" });
  });

  it("rejects a malformed mobile number with a friendly message", async () => {
    const pg = await db();
    await assert.rejects(apply(pg, { paynow_mobile: "61234567" }), /8 digits starting with 8 or 9/);
  });

  it("still accepts an older app's submission (empty or free-text PayNow UEN, no mobile)", async () => {
    const pg = await db();
    assert.deepEqual(await apply(pg, { paynow_uen: "" }), { paynow_mobile: null, paynow_uen: null });
    assert.deepEqual(await apply(pg, { paynow_uen: "my dbs acct" }), { paynow_mobile: null, paynow_uen: "my dbs acct" });
  });

  it("never gets in the way of HQ approving an older application", async () => {
    const pg = await db();
    await as(pg, ADMIN, async () => {
      const { rows } = await pg.query<{ status: string }>(
        `update public.cook_applications set status = 'approved' where user_id = '${OLD_APPLICANT}' returning status`
      );
      assert.deepEqual(rows, [{ status: "approved" }]);
    });
  });

  it("is safe to run twice", async () => {
    const pg = await db();
    await pg.exec(PAYNOW_SQL);
    assert.deepEqual(await apply(pg, { paynow_mobile: "91234567" }), { paynow_mobile: "91234567", paynow_uen: null });
  });
});

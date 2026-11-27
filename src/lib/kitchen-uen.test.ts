import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KITCHEN_UEN_COPY,
  claimShowsUenLine,
  isLiveField,
  kitchenUenState,
  loadApprovedBusinessType,
  runUenStep,
  type KitchenUenState,
  type UenRpc,
} from "./kitchen-uen.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("kitchenUenState: which shops see the UEN", () => {
  it("Home Cook: nothing changes, live or not, UEN or not", () => {
    for (const isLive of [true, false]) {
      for (const kitchenUen of [null, "", "53123456X"]) {
        assert.deepEqual(kitchenUenState({ approvedApp: { business_type: "Home Cook" }, kitchenUen, isLive }), { kind: "not-needed" });
      }
    }
  });

  it("no approved application: nothing changes", () => {
    assert.deepEqual(kitchenUenState({ approvedApp: null, kitchenUen: null, isLive: false }), { kind: "not-needed" });
  });

  it("not Home Cook, not live, no UEN: the field is shown", () => {
    assert.deepEqual(kitchenUenState({ approvedApp: { business_type: "Hawker" }, kitchenUen: null, isLive: false }), { kind: "missing" });
    assert.deepEqual(kitchenUenState({ approvedApp: { business_type: "Bakery" }, kitchenUen: "  ", isLive: false }), { kind: "missing" });
  });

  it("an approved application with no type isn't Home Cook, so it needs a UEN too (as in the database)", () => {
    assert.deepEqual(kitchenUenState({ approvedApp: { business_type: null }, kitchenUen: null, isLive: false }), { kind: "missing" });
  });

  it("UEN saved, not live yet: shown read-only", () => {
    assert.deepEqual(kitchenUenState({ approvedApp: { business_type: "Hawker" }, kitchenUen: "53123456X", isLive: false }), {
      kind: "saved",
      uen: "53123456X",
    });
  });

  it("live: read-only and locked, with or without a UEN", () => {
    assert.deepEqual(kitchenUenState({ approvedApp: { business_type: "Hawker" }, kitchenUen: "53123456X", isLive: true }), {
      kind: "locked",
      uen: "53123456X",
    });
    assert.deepEqual(kitchenUenState({ approvedApp: { business_type: "Hawker" }, kitchenUen: null, isLive: true }), { kind: "locked", uen: null });
  });
});

function fakeRpc(answer: { data?: unknown; error?: { message?: string; details?: string } | null } | "throw") {
  const calls: { fn: string; args: { p_uen: string } }[] = [];
  const rpc: UenRpc = async (fn, args) => {
    calls.push({ fn, args });
    if (answer === "throw") throw new Error("network");
    return { data: answer.data ?? null, error: answer.error ?? null };
  };
  return { rpc, calls };
}

describe("runUenStep: the save, UEN first", () => {
  for (const state of [{ kind: "not-needed" }, { kind: "saved", uen: "53123456X" }, { kind: "locked", uen: "53123456X" }] as KitchenUenState[]) {
    it(`${state.kind}: goes live as before, set_my_business_uen isn't called`, async () => {
      const f = fakeRpc({ data: "X" });
      assert.deepEqual(await runUenStep(state, "201912345K", f.rpc), { goLive: true });
      assert.equal(f.calls.length, 0);
    });
  }

  it("missing and left empty: everything else saves, without going live, and no error", async () => {
    const f = fakeRpc({ data: "X" });
    assert.deepEqual(await runUenStep({ kind: "missing" }, "   ", f.rpc), { goLive: false, error: null });
    assert.equal(f.calls.length, 0);
  });

  it("missing and badly formatted: caught before the call, with the application form's message", async () => {
    const f = fakeRpc({ data: "X" });
    assert.deepEqual(await runUenStep({ kind: "missing" }, "12345", f.rpc), {
      goLive: false,
      error: "That doesn't look like a valid UEN (e.g. 53123456X or 201912345K).",
    });
    assert.equal(f.calls.length, 0);
  });

  it("missing and valid: calls set_my_business_uen with the cleaned-up UEN, then goes live", async () => {
    const f = fakeRpc({ data: "201912345K" });
    assert.deepEqual(await runUenStep({ kind: "missing" }, " 201912345k ", f.rpc), { goLive: true, savedUen: "201912345K" });
    assert.deepEqual(f.calls, [{ fn: "set_my_business_uen", args: { p_uen: "201912345K" } }]);
  });

  it("the database's plain-words error is shown as it is, and the kitchen doesn't go live", async () => {
    const f = fakeRpc({ error: { message: "This UEN is already used by another shop." } });
    assert.deepEqual(await runUenStep({ kind: "missing" }, "53123456X", f.rpc), {
      goLive: false,
      error: "This UEN is already used by another shop.",
    });
  });

  it("an error with no words, or a call that throws: a friendly fallback", async () => {
    assert.deepEqual(await runUenStep({ kind: "missing" }, "53123456X", fakeRpc({ error: { message: " " } }).rpc), {
      goLive: false,
      error: KITCHEN_UEN_COPY.rpcFailed,
    });
    assert.deepEqual(await runUenStep({ kind: "missing" }, "53123456X", fakeRpc("throw").rpc), { goLive: false, error: KITCHEN_UEN_COPY.rpcFailed });
  });
});

describe("isLiveField", () => {
  it("is_live: true only once the UEN is in; otherwise not sent at all", () => {
    assert.deepEqual(isLiveField({ goLive: true }), { is_live: true });
    assert.deepEqual(isLiveField({ goLive: false, error: null }), {});
    assert.equal("is_live" in isLiveField({ goLive: false, error: "x" }), false);
  });
});

function fakeApplications(result: { data: unknown; error: unknown }) {
  const calls: [string, ...unknown[]][] = [];
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "abortSignal"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = async () => result;
  const client = {
    from: (table: string) => {
      calls.push(["from", table]);
      return builder;
    },
  };
  return { client: client as never, calls };
}

describe("loadApprovedBusinessType: same rule as the database", () => {
  it("latest APPROVED application: reviewed_at desc (nulls last), then created_at desc", async () => {
    const f = fakeApplications({ data: { business_type: "Hawker" }, error: null });
    const signal = new AbortController().signal;
    assert.deepEqual(await loadApprovedBusinessType(f.client, "u1", signal), { ok: true, approvedApp: { business_type: "Hawker" } });
    assert.deepEqual(f.calls, [
      ["from", "cook_applications"],
      ["select", "business_type"],
      ["eq", "user_id", "u1"],
      ["eq", "status", "approved"],
      ["order", "reviewed_at", { ascending: false, nullsFirst: false }],
      ["order", "created_at", { ascending: false }],
      ["limit", 1],
      ["abortSignal", signal],
    ]);
  });

  it("none approved: null; a failed read: not ok (never guessed)", async () => {
    const signal = new AbortController().signal;
    assert.deepEqual(await loadApprovedBusinessType(fakeApplications({ data: null, error: null }).client, "u1", signal), { ok: true, approvedApp: null });
    assert.deepEqual(await loadApprovedBusinessType(fakeApplications({ data: null, error: { code: "500" } }).client, "u1", signal), { ok: false });
  });
});

describe("the claim page line", () => {
  it("not Home Cook and no UEN: shown", () => {
    assert.equal(claimShowsUenLine({ category: "hawker", business_uen: null }), true);
    assert.equal(claimShowsUenLine({ category: "bakery", business_uen: " " }), true);
  });
  it("Home Cook, or a UEN already there: not shown", () => {
    assert.equal(claimShowsUenLine({ category: "home-cook", business_uen: null }), false);
    assert.equal(claimShowsUenLine({ category: "hawker", business_uen: "53123456X" }), false);
  });
  it("says it word for word, and ClaimFlow shows it under the shop details", () => {
    assert.equal(KITCHEN_UEN_COPY.claimLine, "You'll add your UEN in Kitchen Setup before going live.");
    const flow = read("../components/ClaimFlow.tsx");
    assert.match(flow, /claimShowsUenLine\(shop\) \?[\s\S]{0,200}KITCHEN_UEN_COPY\.claimLine/);
  });
});

describe("Kitchen Setup wiring", () => {
  const form = read("../components/KitchenSetupForm.tsx");
  const page = read("../app/kitchen/page.tsx");
  const saveKitchen = form.slice(form.indexOf("async function saveKitchen("), form.indexOf("async function saveAddons("));

  it("the words the owner sees", () => {
    assert.equal(KITCHEN_UEN_COPY.title, "Add your UEN to go live");
    assert.equal(KITCHEN_UEN_COPY.why, "Your UEN is needed to put your shop on Kopi Boy.");
    assert.equal(KITCHEN_UEN_COPY.lockedNote, "Message Kopi Boy HQ to change it.");
  });

  it("calls set_my_business_uen before the kitchen save", () => {
    const uen = saveKitchen.indexOf("runUenStep(uenState, uenInput");
    const row = saveKitchen.indexOf("saveKitchenRow(supabase");
    assert.ok(uen > 0 && row > uen);
    assert.match(saveKitchen, /supabase\.rpc\(fn, args\)/);
  });

  it("sends is_live only through isLiveField, never a bare is_live: true", () => {
    assert.match(saveKitchen, /\.\.\.isLiveField\(uenStep\)/);
    assert.doesNotMatch(form, /is_live: true/);
  });

  it("a save left not live stays on the page with the note, instead of leaving", () => {
    const stay = saveKitchen.indexOf("if (stayNotice)");
    assert.ok(stay > 0 && stay < saveKitchen.indexOf("router.push"));
    assert.match(saveKitchen, /uenNote: uenStep\.goLive \? null : KITCHEN_UEN_COPY\.savedNotLive/);
    assert.match(saveKitchen, /setNotice\(stayNotice\)/);
  });

  it("shows the UEN error under the box, and the locked note when live", () => {
    assert.match(form, /setUenError\(uenStep\.goLive \? null : uenStep\.error\)/);
    assert.match(form, /id="uen-error" role="alert"/);
    assert.match(form, /state\.kind === "locked" && [\s\S]{0,200}KITCHEN_UEN_COPY\.lockedNote/);
  });

  it("/kitchen loads the approved application, retries if it fails, and passes the state", () => {
    assert.match(page, /loadApprovedBusinessType\(supabase, userId, signal\)/);
    assert.match(page, /failed: profileFailed \|\| !!kitchenRead\.error \|\| !approved\.ok/);
    assert.match(page, /uenState=\{kitchen \? kitchenUenState\(\{ approvedApp, kitchenUen: kitchen\.business_uen, isLive: kitchen\.is_live \}\)/);
  });

  it("first-time setup (Home Cook flow) passes no UEN state, so it's unchanged", () => {
    assert.doesNotMatch(read("../components/KitchenSetupGate.tsx"), /uenState/);
    assert.doesNotMatch(read("../app/page.tsx"), /uenState/);
  });
});

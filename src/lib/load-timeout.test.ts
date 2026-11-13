import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LoadTimeoutError, retryOnce, withTimeout } from "./load-timeout.ts";
import { loadPartnerState, loadUser, partnerReadsFrom, type PartnerReads } from "./partner-state.ts";

const never = () => new Promise<never>(() => {});
const ok = { data: null, error: null };
const reads = (over: Partial<Parameters<typeof partnerReadsFrom>[0]> = {}): PartnerReads =>
  partnerReadsFrom({ profile: ok, cookApp: ok, riderApp: ok, kitchen: ok, ...over });
// loadPartnerState only uses the client through readOnce here.
const noClient = {} as Parameters<typeof loadPartnerState>[0];

describe("withTimeout", () => {
  it("gives up on work that never finishes, and aborts its signal", async () => {
    let signal: AbortSignal | null = null;
    await assert.rejects(
      withTimeout((s) => {
        signal = s;
        return never();
      }, 20),
      LoadTimeoutError,
    );
    assert.equal(signal!.aborted, true);
  });

  it("passes through a result that arrives in time", async () => {
    assert.equal(await withTimeout(async () => 42, 1000), 42);
  });
});

describe("retryOnce", () => {
  it("retries once after a throw, then gives the second result", async () => {
    let calls = 0;
    const result = await retryOnce(async () => {
      calls++;
      if (calls === 1) throw new Error("first");
      return "second";
    });
    assert.equal(result, "second");
    assert.equal(calls, 2);
  });

  it("retries once on a failed result, never more", async () => {
    let calls = 0;
    const result = await retryOnce(async () => ++calls, () => true);
    assert.equal(result, 2);
    assert.equal(calls, 2);
  });

  it("doesn't retry a success", async () => {
    let calls = 0;
    await retryOnce(async () => ++calls);
    assert.equal(calls, 1);
  });
});

describe("loadPartnerState", () => {
  it("a read that never comes back ends in ok:false after the retry (no endless skeleton)", async () => {
    let calls = 0;
    const result = await loadPartnerState(noClient, "u-1", { timeoutMs: 20, readOnce: () => (calls++, never()) });
    assert.deepEqual(result, { ok: false });
    assert.equal(calls, 2);
  });

  it("a profile or application error after the retry: ok:false, never guessed as 'no application'", async () => {
    for (const over of [{ profile: { data: null, error: { code: "08006" } } }, { cookApp: { data: null, error: {} } }, { riderApp: { data: null, error: {} } }]) {
      const result = await loadPartnerState(noClient, "u-1", { readOnce: async () => reads(over) });
      assert.deepEqual(result, { ok: false });
    }
  });

  it("no profile row is not an error", async () => {
    const result = await loadPartnerState(noClient, "u-1", { readOnce: async () => reads({ profile: { data: null, error: { code: "PGRST116" } } }) });
    assert.equal(result.ok, true);
  });

  it("only the kitchen failing: ok, with kitchenError (routing shows the kitchen error screen)", async () => {
    const result = await loadPartnerState(noClient, "u-1", { readOnce: async () => reads({ kitchen: { data: null, error: {} } }) });
    assert.equal(result.ok && result.state.kitchenError, true);
  });

  it("a failed first try that works the second time just loads", async () => {
    let calls = 0;
    const result = await loadPartnerState(noClient, "u-1", {
      readOnce: async () => (++calls === 1 ? reads({ cookApp: { data: null, error: {} } }) : reads()),
    });
    assert.equal(result.ok, true);
    assert.equal(calls, 2);
  });
});

describe("loadUser", () => {
  it("signed out is not a failure", async () => {
    const client = { auth: { getUser: async () => ({ data: { user: null }, error: { name: "AuthSessionMissingError" } }) } };
    assert.deepEqual(await loadUser(client as unknown as Parameters<typeof loadUser>[0], 50), { ok: true, user: null });
  });

  it("a session check that never comes back: ok:false", async () => {
    const client = { auth: { getUser: never } };
    assert.deepEqual(await loadUser(client as unknown as Parameters<typeof loadUser>[0], 20), { ok: false });
  });
});

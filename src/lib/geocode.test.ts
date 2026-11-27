import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { geocodePostalCode } from "./geocode.ts";
import { FAILURE_BACKOFF_MS, ONEMAP_TOKEN_URL, REFRESH_MARGIN_MS, getOneMapToken, resetOneMapTokenCache } from "./onemap-token.ts";

const realFetch = globalThis.fetch;
const realError = console.error;
const EMAIL = "kitchen-test@example.invalid";
const PASSWORD = "secret-password-123";
const HOUR = 60 * 60 * 1000;

type Call = { url: string; init?: RequestInit };
let logs: string[] = [];

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return impl(url, init);
  }) as typeof fetch;
  return calls;
}

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

const isTokenCall = (url: string) => url === ONEMAP_TOKEN_URL;
const tokenCalls = (calls: Call[]) => calls.filter((c) => isTokenCall(c.url));
const searchCalls = (calls: Call[]) => calls.filter((c) => !isTokenCall(c.url));
const authOf = (c: Call) => new Headers(c.init?.headers).get("authorization");
/** expiry_timestamp as OneMap sends it: Unix seconds, as a string. */
const expiresIn = (ms: number) => String(Math.floor((Date.now() + ms) / 1000));

const TOA_PAYOH = {
  SEARCHVAL: "BLK 123",
  POSTAL: "310123",
  ADDRESS: "123 LORONG 1 TOA PAYOH SINGAPORE 310123",
  LATITUDE: "1.33722605245",
  LONGITUDE: "103.84557263523",
};

/** OneMap with credentials: getToken hands out tok-1, tok-2, …; search accepts only `accept(token)`. */
function oneMap(accept: (token: string | null) => boolean = () => true, { lifetimeMs = 72 * HOUR } = {}) {
  let issued = 0;
  return mockFetch((url, init) => {
    if (isTokenCall(url)) {
      issued += 1;
      return json({ access_token: `tok-${issued}`, expiry_timestamp: expiresIn(lifetimeMs) });
    }
    const token = new Headers(init?.headers).get("authorization");
    return accept(token) ? json({ found: 1, results: [TOA_PAYOH] }) : json({ message: "Unauthorized" }, 401);
  });
}

beforeEach(() => {
  resetOneMapTokenCache();
  logs = [];
  console.error = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
  mock.timers.reset();
  delete process.env.ONEMAP_TOKEN;
  delete process.env.ONEMAP_EMAIL;
  delete process.env.ONEMAP_PASSWORD;
  // No secret ever reaches a log line.
  for (const line of logs) {
    for (const secret of [EMAIL, PASSWORD, "tok-", "static-token"]) assert.ok(!line.includes(secret), `log leaks a secret: ${line}`);
  }
});

function withCredentials() {
  process.env.ONEMAP_EMAIL = EMAIL;
  process.env.ONEMAP_PASSWORD = PASSWORD;
}

describe("geocodePostalCode: results", () => {
  it("rejects anything that isn't exactly 6 digits without calling OneMap", async () => {
    const calls = mockFetch(() => json({ results: [] }));
    for (const bad of ["", "31012", "3101234", "31012a", "310 123"]) {
      assert.deepEqual(await geocodePostalCode(bad), { ok: false, reason: "invalid" });
    }
    assert.equal(calls.length, 0);
  });

  it("returns the result whose POSTAL matches, with numeric coordinates", async () => {
    const calls = mockFetch(() =>
      json({
        found: 2,
        results: [{ ...TOA_PAYOH, POSTAL: "310124", LATITUDE: "9", LONGITUDE: "9" }, TOA_PAYOH],
      })
    );
    const result = await geocodePostalCode("310123");
    assert.deepEqual(result, {
      ok: true,
      lat: 1.33722605245,
      lng: 103.84557263523,
      address: TOA_PAYOH.ADDRESS,
    });
    assert.equal(calls.length, 1);
    const url = new URL(calls[0].url);
    assert.equal(url.origin + url.pathname, "https://www.onemap.gov.sg/api/common/elastic/search");
    assert.equal(url.searchParams.get("searchVal"), "310123");
    assert.equal(url.searchParams.get("returnGeom"), "Y");
    assert.equal(url.searchParams.get("getAddrDetails"), "Y");
    assert.equal(url.searchParams.get("pageNum"), "1");
    assert.ok(calls[0].init?.signal, "request should carry a timeout signal");
    assert.equal(calls[0].init?.cache, "no-store");
  });

  it("returns not_found when no result has the exact postal code", async () => {
    mockFetch(() => json({ found: 1, results: [{ ...TOA_PAYOH, POSTAL: "310124" }] }));
    assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "not_found" });
  });

  it("returns not_found for an empty result list with no error", async () => {
    mockFetch(() => json({ found: 0, results: [] }));
    assert.deepEqual(await geocodePostalCode("999999"), { ok: false, reason: "not_found" });
  });

  it("accepts results that come with a token note alongside them", async () => {
    mockFetch(() => json({ error: "Token missing", found: 1, results: [TOA_PAYOH] }));
    assert.equal((await geocodePostalCode("310123")).ok, true);
  });
});

describe("geocodePostalCode: failures are 'unavailable' and logged without secrets", () => {
  it("network error", async () => {
    mockFetch(() => Promise.reject(new TypeError("fetch failed")));
    assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "unavailable" });
    assert.deepEqual(logs, ["onemap credentials missing, using ONEMAP_TOKEN", "onemap search network error"]);
  });

  it("timeout", async () => {
    mockFetch(() => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")));
    assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "unavailable" });
    assert.ok(logs.includes("onemap search timeout"));
  });

  it("server error", async () => {
    mockFetch(() => json({ error: "Internal error" }, 500));
    assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "unavailable" });
    assert.ok(logs.includes("onemap search failed 500"));
  });

  it("rate limit", async () => {
    mockFetch(() => json({ message: "Too many requests" }, 429));
    assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "unavailable" });
    assert.ok(logs.includes("onemap search failed 429 (rate limited)"));
  });

  it("a token error with empty results (OneMap docs: HTTP 200) is not 'not found'", async () => {
    for (const error of [
      "Authentication token expired. Tokens is valid for 3 days. Please implement automatic renewal to ensure your token remains valid.",
      "Invalid authentication token. Please register for an account and provide a valid API token.",
      "Authentication token missing. Please create an account and generate or renew your API Token.",
    ]) {
      mockFetch(() => json({ error, found: 0, totalNumPages: 0, pageNum: 0, results: [] }));
      assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "unavailable" });
    }
    assert.ok(logs.includes("onemap search auth failed 200 (token error in body)"));
  });

  it("no token at all, and OneMap answers 401 (as it does live)", async () => {
    mockFetch(() => json({ message: "Unauthorized" }, 401));
    assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "unavailable" });
    assert.ok(logs.includes("onemap search auth failed 401"));
  });
});

describe("OneMap token: getToken, cache and refresh", () => {
  it("fetches a token with the credentials (POST, JSON) and sends it raw as Authorization", async () => {
    withCredentials();
    const calls = oneMap();
    assert.equal((await geocodePostalCode("310123")).ok, true);
    const [t] = tokenCalls(calls);
    assert.equal(t.init?.method, "POST");
    assert.equal(new Headers(t.init?.headers).get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(String(t.init?.body)), { email: EMAIL, password: PASSWORD });
    assert.equal(authOf(searchCalls(calls)[0]), "tok-1");
  });

  it("caches the token: many lookups, one getToken", async () => {
    withCredentials();
    const calls = oneMap();
    for (let i = 0; i < 5; i++) await geocodePostalCode("310123");
    assert.equal(tokenCalls(calls).length, 1);
    assert.ok(searchCalls(calls).every((c) => authOf(c) === "tok-1"));
  });

  it("concurrent lookups share one getToken", async () => {
    withCredentials();
    const calls = oneMap();
    const results = await Promise.all(Array.from({ length: 8 }, () => geocodePostalCode("310123")));
    assert.ok(results.every((r) => r.ok));
    assert.equal(tokenCalls(calls).length, 1);
  });

  it("refreshes once the token is within 12 hours of expiry", async () => {
    withCredentials();
    mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const calls = oneMap();
    await geocodePostalCode("310123");
    mock.timers.tick(72 * HOUR - REFRESH_MARGIN_MS - HOUR); // 13 hours left: still cached
    await geocodePostalCode("310123");
    assert.equal(tokenCalls(calls).length, 1);
    mock.timers.tick(2 * HOUR); // 11 hours left: refresh
    await geocodePostalCode("310123");
    assert.equal(tokenCalls(calls).length, 2);
    assert.equal(authOf(searchCalls(calls).at(-1)!), "tok-2");
  });

  it("a 401 on search fetches a fresh token and retries once", async () => {
    withCredentials();
    const calls = oneMap((t) => t === "tok-2"); // tok-1 gets rejected
    assert.equal((await geocodePostalCode("310123")).ok, true);
    assert.equal(tokenCalls(calls).length, 2);
    assert.deepEqual(searchCalls(calls).map(authOf), ["tok-1", "tok-2"]);
  });

  it("retries only once: still rejected -> unavailable", async () => {
    withCredentials();
    const calls = oneMap(() => false);
    assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "unavailable" });
    assert.equal(searchCalls(calls).length, 2);
  });

  it("a token error in a 200 body also triggers the refresh and retry", async () => {
    withCredentials();
    let issued = 0;
    const calls = mockFetch((url, init) => {
      if (isTokenCall(url)) return json({ access_token: `tok-${++issued}`, expiry_timestamp: expiresIn(72 * HOUR) });
      return new Headers(init?.headers).get("authorization") === "tok-1"
        ? json({ error: "Authentication token expired. Tokens is valid for 3 days.", found: 0, results: [] })
        : json({ found: 1, results: [TOA_PAYOH] });
    });
    assert.equal((await geocodePostalCode("310123")).ok, true);
    assert.deepEqual(searchCalls(calls).map(authOf), ["tok-1", "tok-2"]);
  });
});

describe("OneMap token: fallback to ONEMAP_TOKEN", () => {
  it("no credentials: ONEMAP_TOKEN is sent, getToken never called", async () => {
    process.env.ONEMAP_TOKEN = "static-token";
    const calls = mockFetch(() => json({ results: [TOA_PAYOH] }));
    assert.equal((await geocodePostalCode("310123")).ok, true);
    assert.equal(tokenCalls(calls).length, 0);
    assert.equal(authOf(calls[0]), "static-token");
  });

  it("no credentials and no token: no Authorization header", async () => {
    const calls = mockFetch(() => json({ results: [TOA_PAYOH] }));
    await geocodePostalCode("310123");
    assert.equal(authOf(calls[0]), null);
  });

  for (const [what, tokenAnswer, logLine] of [
    ["getToken answers 401", () => json({ error: "Invalid credentials" }, 401), "onemap token fetch failed 401"],
    ["getToken times out", () => Promise.reject(new DOMException("timeout", "TimeoutError")), "onemap token fetch timeout"],
    ["getToken network error", () => Promise.reject(new TypeError("fetch failed")), "onemap token fetch network error"],
    ["getToken has no access_token", () => json({ expiry_timestamp: "1" }), "onemap token fetch failed: no access_token in response"],
  ] as const) {
    it(`${what}: falls back to ONEMAP_TOKEN, logs "${logLine}"`, async () => {
      withCredentials();
      process.env.ONEMAP_TOKEN = "static-token";
      const calls = mockFetch((url) => (isTokenCall(url) ? tokenAnswer() : json({ results: [TOA_PAYOH] })));
      assert.equal((await geocodePostalCode("310123")).ok, true);
      assert.equal(authOf(searchCalls(calls)[0]), "static-token");
      assert.ok(logs.includes(logLine), logs.join("\n"));
    });
  }

  it("after a failed getToken, waits before asking again (no hammering)", async () => {
    withCredentials();
    process.env.ONEMAP_TOKEN = "static-token";
    mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const calls = mockFetch((url) => (isTokenCall(url) ? json({}, 500) : json({ results: [TOA_PAYOH] })));
    await geocodePostalCode("310123");
    await geocodePostalCode("310123");
    assert.equal(tokenCalls(calls).length, 1);
    mock.timers.tick(FAILURE_BACKOFF_MS + 1);
    await geocodePostalCode("310123");
    assert.equal(tokenCalls(calls).length, 2);
  });

  it("the fallback token rejected and nothing fresher: no second, identical search", async () => {
    process.env.ONEMAP_TOKEN = "static-token";
    const calls = mockFetch(() => json({ message: "Unauthorized" }, 401));
    assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "unavailable" });
    assert.equal(calls.length, 1);
  });

  it("getOneMapToken never throws, and returns null when there is nothing", async () => {
    mockFetch(() => Promise.reject(new Error("boom")));
    assert.equal(await getOneMapToken(), null);
    withCredentials();
    assert.equal(await getOneMapToken({ forceRefresh: true }), null);
  });
});

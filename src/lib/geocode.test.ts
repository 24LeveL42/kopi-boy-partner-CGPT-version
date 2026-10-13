import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { geocodePostalCode } from "./geocode.ts";

const realFetch = globalThis.fetch;

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
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

const TOA_PAYOH = {
  SEARCHVAL: "BLK 123",
  POSTAL: "310123",
  ADDRESS: "123 LORONG 1 TOA PAYOH SINGAPORE 310123",
  LATITUDE: "1.33722605245",
  LONGITUDE: "103.84557263523",
};

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.ONEMAP_TOKEN;
});

describe("geocodePostalCode", () => {
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
  });

  it("returns not_found when no result has the exact postal code", async () => {
    mockFetch(() => json({ found: 1, results: [{ ...TOA_PAYOH, POSTAL: "310124" }] }));
    assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "not_found" });
  });

  it("returns not_found for an empty result list", async () => {
    mockFetch(() => json({ found: 0, results: [] }));
    assert.deepEqual(await geocodePostalCode("999999"), { ok: false, reason: "not_found" });
  });

  it("returns unavailable on a network error", async () => {
    mockFetch(() => Promise.reject(new TypeError("fetch failed")));
    assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "unavailable" });
  });

  it("returns unavailable on a timeout", async () => {
    mockFetch(() => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")));
    assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "unavailable" });
  });

  it("returns unavailable on a server error with no results", async () => {
    mockFetch(() => json({ error: "Internal error" }, 500));
    assert.deepEqual(await geocodePostalCode("310123"), { ok: false, reason: "unavailable" });
  });

  it("ignores OneMap's 'token missing' error field and judges by results", async () => {
    const calls = mockFetch(() => json({ error: "Token missing", found: 1, results: [TOA_PAYOH] }));
    const result = await geocodePostalCode("310123");
    assert.equal(result.ok, true);
    assert.equal(new Headers(calls[0].init?.headers).get("authorization"), null);
  });

  it("sends ONEMAP_TOKEN as the Authorization header when set", async () => {
    process.env.ONEMAP_TOKEN = "test-token";
    const calls = mockFetch(() => json({ results: [TOA_PAYOH] }));
    await geocodePostalCode("310123");
    assert.equal(new Headers(calls[0].init?.headers).get("authorization"), "test-token");
  });
});

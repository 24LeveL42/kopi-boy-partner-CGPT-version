/**
 * Postal code -> coordinates via OneMap (Singapore Land Authority).
 *
 * Server-only: import it from Server Actions / Route Handlers, never from a
 * "use client" module, so the OneMap credentials and token never reach a
 * browser bundle. The token comes from ./onemap-token.ts.
 */

import { getOneMapToken } from "./onemap-token.ts";

export type GeocodeResult =
  | { ok: true; lat: number; lng: number; address: string }
  | { ok: false; reason: "invalid" | "not_found" | "unavailable" };

const ONEMAP_SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search";
const TIMEOUT_MS = 6_000;

interface OneMapResult {
  POSTAL?: string;
  ADDRESS?: string;
  LATITUDE?: string;
  LONGITUDE?: string;
}

type SearchOutcome = { kind: "results"; results: OneMapResult[] } | { kind: "auth" } | { kind: "failed" };

/**
 * One search. A rejected token shows up two ways: HTTP 401/403 (what the live
 * API answers today), or, per the OneMap docs, HTTP 200 with an "error" about
 * the token and an empty results list. Both are "auth", never "not found".
 */
async function search(url: string, token: string | null): Promise<SearchOutcome> {
  try {
    const res = await fetch(url, {
      // OneMap documents the token as the raw Authorization value (no "Bearer").
      headers: token ? { Authorization: token } : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) {
      console.error(`onemap search auth failed ${res.status}`);
      return { kind: "auth" };
    }
    const body = (await res.json().catch(() => null)) as { results?: unknown; error?: unknown } | null;
    const results = Array.isArray(body?.results) ? (body.results as OneMapResult[]) : null;
    const tokenError = typeof body?.error === "string" && /token/i.test(body.error);
    if (tokenError && !results?.length) {
      console.error(`onemap search auth failed ${res.status} (token error in body)`);
      return { kind: "auth" };
    }
    if (!res.ok) {
      console.error(`onemap search failed ${res.status}${res.status === 429 ? " (rate limited)" : ""}`);
      return { kind: "failed" };
    }
    if (!results) {
      console.error(`onemap search failed ${res.status}: no results in response`);
      return { kind: "failed" };
    }
    return { kind: "results", results };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    console.error(timedOut ? "onemap search timeout" : "onemap search network error");
    return { kind: "failed" };
  }
}

export async function geocodePostalCode(postal: string): Promise<GeocodeResult> {
  const code = postal.trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: "invalid" };

  const url = `${ONEMAP_SEARCH_URL}?searchVal=${code}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;

  const token = await getOneMapToken();
  let outcome = await search(url, token);
  if (outcome.kind === "auth") {
    // Rejected: get a fresh token and try once more, only if it's a different one.
    const fresh = await getOneMapToken({ forceRefresh: true });
    if (fresh && fresh !== token) outcome = await search(url, fresh);
  }
  if (outcome.kind !== "results") return { ok: false, reason: "unavailable" };

  for (const r of outcome.results) {
    if (r.POSTAL !== code) continue;
    const lat = Number(r.LATITUDE);
    const lng = Number(r.LONGITUDE);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    return { ok: true, lat, lng, address: r.ADDRESS ?? code };
  }
  return { ok: false, reason: "not_found" };
}

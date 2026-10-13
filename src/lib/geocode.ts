/**
 * Postal code -> coordinates via OneMap (Singapore Land Authority).
 *
 * Server-only: import it from Server Actions / Route Handlers, never from a
 * "use client" module, so ONEMAP_TOKEN never reaches a browser bundle.
 */

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

export async function geocodePostalCode(postal: string): Promise<GeocodeResult> {
  const code = postal.trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: "invalid" };

  const url = `${ONEMAP_SEARCH_URL}?searchVal=${code}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
  const token = process.env.ONEMAP_TOKEN;

  let results: OneMapResult[];
  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: token } : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // OneMap currently answers without a token but adds a "token missing"
    // error field alongside the results — judge only by `results`.
    const body = (await res.json().catch(() => null)) as { results?: unknown } | null;
    if (!Array.isArray(body?.results)) return { ok: false, reason: "unavailable" };
    results = body.results as OneMapResult[];
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  for (const r of results) {
    if (r.POSTAL !== code) continue;
    const lat = Number(r.LATITUDE);
    const lng = Number(r.LONGITUDE);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    return { ok: true, lat, lng, address: r.ADDRESS ?? code };
  }
  return { ok: false, reason: "not_found" };
}

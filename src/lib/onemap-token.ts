/**
 * OneMap access token, server only (never import from a "use client" module).
 *
 * OneMap's search needs a token, and each token is valid for 3 days. Per the
 * OneMap API docs (Authentication):
 *   POST https://www.onemap.gov.sg/api/auth/post/getToken
 *   body {"email": "...", "password": "..."}
 *   200 -> {"access_token": "...", "expiry_timestamp": "1689388144"}  (Unix seconds, as a string)
 *
 * The token is fetched with ONEMAP_EMAIL / ONEMAP_PASSWORD, kept in module
 * memory, and fetched again when it is within 12 hours of expiry (or when a
 * search says it was rejected). One fetch at a time: concurrent callers share
 * the same promise. If there are no credentials, or getToken fails, the static
 * ONEMAP_TOKEN is used instead.
 *
 * Nothing here ever logs or returns the email, password or token in an error.
 */

export const ONEMAP_TOKEN_URL = "https://www.onemap.gov.sg/api/auth/post/getToken";
/** Refresh when the cached token has less than this left. */
export const REFRESH_MARGIN_MS = 12 * 60 * 60 * 1000;
/** After a failed getToken, wait this long before asking again (OneMap bans repeated getToken calls). */
export const FAILURE_BACKOFF_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 6_000;

let cached: { token: string; expiresAtMs: number } | null = null;
let inFlight: Promise<string | null> | null = null;
let lastFailureAtMs: number | null = null;
let warnedNoCredentials = false;

/** Tests only: forget the cached token and any backoff. */
export function resetOneMapTokenCache() {
  cached = null;
  inFlight = null;
  lastFailureAtMs = null;
  warnedNoCredentials = false;
}

function fallbackToken(): string | null {
  return process.env.ONEMAP_TOKEN?.trim() || null;
}

/**
 * The token to send to OneMap, or null if there is none at all.
 * `forceRefresh`: the last one was rejected, so don't trust the cache.
 */
export async function getOneMapToken({ forceRefresh = false }: { forceRefresh?: boolean } = {}): Promise<string | null> {
  const now = Date.now();
  if (forceRefresh) cached = null;
  if (cached && cached.expiresAtMs - now > REFRESH_MARGIN_MS) return cached.token;

  const email = process.env.ONEMAP_EMAIL?.trim();
  const password = process.env.ONEMAP_PASSWORD;
  if (!email || !password) {
    if (!warnedNoCredentials) {
      warnedNoCredentials = true;
      console.error("onemap credentials missing, using ONEMAP_TOKEN");
    }
    return fallbackToken();
  }

  // A recent getToken failed: don't ask again yet (unless one is already on its way).
  if (!inFlight && lastFailureAtMs !== null && now - lastFailureAtMs < FAILURE_BACKOFF_MS) {
    return cached?.token ?? fallbackToken();
  }

  if (!inFlight) {
    inFlight = fetchToken(email, password).finally(() => {
      inFlight = null;
    });
  }
  const fresh = await inFlight;
  // A token that's still valid but near expiry beats the static fallback.
  return fresh ?? cached?.token ?? fallbackToken();
}

async function fetchToken(email: string, password: string): Promise<string | null> {
  try {
    const res = await fetch(ONEMAP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return failed(`onemap token fetch failed ${res.status}`);
    const body = (await res.json().catch(() => null)) as { access_token?: unknown; expiry_timestamp?: unknown } | null;
    const token = typeof body?.access_token === "string" ? body.access_token.trim() : "";
    if (!token) return failed("onemap token fetch failed: no access_token in response");

    const expirySeconds = Number(body?.expiry_timestamp);
    let expiresAtMs: number;
    if (Number.isFinite(expirySeconds) && expirySeconds > 0) {
      expiresAtMs = expirySeconds * 1000;
    } else {
      console.error("onemap token fetch: no usable expiry_timestamp, caching for 1 hour");
      expiresAtMs = Date.now() + REFRESH_MARGIN_MS + 60 * 60 * 1000;
    }
    cached = { token, expiresAtMs };
    lastFailureAtMs = null;
    return token;
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return failed(timedOut ? "onemap token fetch timeout" : "onemap token fetch network error");
  }
}

function failed(line: string): null {
  console.error(line);
  lastFailureAtMs = Date.now();
  return null;
}

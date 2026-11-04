/**
 * Open-redirect guard for any redirect target that comes from the user
 * (query string, form field, cookie).
 *
 * Only a same-site relative path is allowed: it starts with exactly one "/"
 * and holds nothing but printable ASCII other than "\", "@" and ":". That
 * rules out "//evil.com" and "/\evil.com" (browsers read both as another
 * host), "@evil.com" (`${origin}@evil.com` makes the origin a username),
 * any scheme (javascript:, data:, https:), whitespace and control
 * characters (browsers strip tabs/newlines, so "/\t/evil.com" becomes
 * "//evil.com"), and non-ASCII look-alikes.
 *
 * Every percent-decoded layer is checked too, so "%2F%2Fevil.com" and
 * "%252F%252Fevil.com" fail like "//evil.com". A value that can't be decoded,
 * or is still changing after MAX_DECODES rounds, is refused.
 *
 * Anything that fails returns `fallback`. The value returned is the original
 * string, unchanged, so a valid path redirects exactly as it did before.
 */

const MAX_DECODES = 5;
const MAX_LENGTH = 2048;

/** Allowed: "!" (0x21) to "~" (0x7e), minus "\" "@" ":". */
const ALLOWED_CHARS = /^[\x21-\x7e]*$/;
const FORBIDDEN_CHARS = /[\\@:]/;

function isSafeLayer(path: string): boolean {
  if (!path.startsWith("/")) return false;
  // "//host" and "/\host" are protocol-relative (other site).
  if (path[1] === "/" || path[1] === "\\") return false;
  if (!ALLOWED_CHARS.test(path)) return false;
  if (FORBIDDEN_CHARS.test(path)) return false;
  return true;
}

export function safeRedirectPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LENGTH) return fallback;

  let layer = value;
  for (let i = 0; i <= MAX_DECODES; i++) {
    if (!isSafeLayer(layer)) return fallback;
    let decoded: string;
    try {
      decoded = decodeURIComponent(layer);
    } catch {
      return fallback; // malformed "%" sequence
    }
    if (decoded === layer) break;
    if (i === MAX_DECODES) return fallback; // still encoded after MAX_DECODES rounds
    layer = decoded;
  }

  // Last check: resolved against a dummy origin, it must stay on that origin.
  try {
    const base = "https://safe-redirect.invalid";
    if (new URL(value, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }

  return value;
}

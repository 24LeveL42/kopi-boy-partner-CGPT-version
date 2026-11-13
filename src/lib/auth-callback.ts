import { safeRedirectPath } from "./safe-redirect.ts";

/**
 * Google's return address: /auth/callback, carrying where to go afterwards
 * (e.g. /welcome) as ?next=. /auth/callback checks it again with
 * safeRedirectPath. Plain "/" adds nothing, so the usual URL is unchanged.
 */
export function authCallbackUrl(origin: string, next: string = "/"): string {
  const safe = safeRedirectPath(next, "/");
  return safe === "/" ? `${origin}/auth/callback` : `${origin}/auth/callback?next=${encodeURIComponent(safe)}`;
}

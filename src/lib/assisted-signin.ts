import {
  CLAIM_STATUSES,
  PLACEHOLDER_EMAIL_DOMAIN,
  callerIp,
  claimResponse,
  clientKeyFor,
  hashToken,
  isTokenShaped,
  tokenFromRequest,
  type ClaimResultStatus,
  type ClaimStatus,
} from "./assisted-claim.ts";

/**
 * Signing an assisted owner back in. Their account has a made-up
 * @assisted.invalid email and no password or Google, so a lost session can't
 * be recovered by the owner. HQ (Boss) sends a one-time link,
 * https://partners.kopi-boy.com/resume#<token> (2 hours, single use). The
 * /resume page posts the token to /api/claim/resume when the owner taps
 * "Sign me in". The route:
 *   1. assisted_signin_consume (service_role only; kopi-boy-boss/docs/
 *      supabase-assisted-signin-link.sql): rate limited in the database,
 *      checks the token and marks it used, returns the shop's claimed_user_id
 *   2. auth.admin.getUserById: that EXISTING user; refused unless its email is
 *      the placeholder kind (never a real person's email or Google account)
 *   3. magic link → verifyOtp on the cookie client: the same sb- session
 *      cookies the claim sets
 * It never creates, deletes or changes a user, a kitchen or any data.
 *
 * Cookies: a browser that is already signed in keeps its session unless a
 * NEW session was actually written. Any non-ok answer from the database, and
 * any failure before verifyOtp, leaves the cookies alone. verifyOtp returning
 * an error leaves them alone too: auth-js writes the session only after
 * Supabase returns one (GoTrueClient.verifyOtp → _saveSession) and returns
 * auth errors without touching storage. Only verifyOtp THROWING (it got past
 * its own error handling, i.e. while or after saving the new session) clears
 * them, so no half-written new session is left behind. After an ok consume
 * the link is used up either way, so on any error the owner asks HQ for a new
 * one.
 *
 * Never log, store or return the raw token, its hash, the user id or the
 * email. Logs carry a fixed label and at most an error code.
 */

type DbError = { code?: string; message?: string } | null;
type AuthError = { code?: string; status?: number; message?: string } | null;

/** The parts of the service-role client the sign-in uses. No createUser, no deleteUser. */
export interface SigninAdminClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError }>;
  auth: {
    admin: {
      getUserById(id: string): Promise<{ data: { user: { id: string; email?: string | null } | null } | null; error: AuthError }>;
      generateLink(params: {
        type: "magiclink";
        email: string;
      }): Promise<{ data: { properties: { hashed_token: string } | null } | null; error: AuthError }>;
    };
  };
}

/** The cookie-writing server client (src/lib/supabase/server.ts): verifyOtp here sets the owner's session cookies. */
export interface SigninSessionClient {
  auth: {
    verifyOtp(params: { token_hash: string; type: "magiclink" }): Promise<{ error: AuthError }>;
  };
}

export interface SigninDeps {
  admin: SigninAdminClient;
  session: SigninSessionClient;
  /** Removes every Supabase auth cookie from the response. Used only when verifyOtp throws (see above). */
  clearAuthCookies: () => void | Promise<void>;
  log?: (label: string, code?: string) => void;
}

export type SigninResult = { status: ClaimResultStatus };

const defaultLog = (label: string, code?: string) => console.error(`signin: ${label}${code ? ` (${code})` : ""}`);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_EMAIL = new RegExp(`^owner-[0-9a-f-]{36}@${PLACEHOLDER_EMAIL_DOMAIN.replace(/\./g, "\\.")}$`);

/** Only an account the claim made: owner-<uuid>@assisted.invalid. */
export function isPlaceholderEmail(email: unknown): email is string {
  return typeof email === "string" && PLACEHOLDER_EMAIL.test(email.toLowerCase());
}

function consumeAnswer(data: unknown): { status: ClaimStatus; userId?: string } | null {
  const d = data as { status?: unknown; user_id?: unknown } | null;
  if (typeof d?.status !== "string" || !(CLAIM_STATUSES as readonly string[]).includes(d.status)) return null;
  const status = d.status as ClaimStatus;
  if (status !== "ok") return { status };
  return typeof d.user_id === "string" && UUID.test(d.user_id) ? { status, userId: d.user_id } : null;
}

export async function signInAssistedOwner(deps: SigninDeps, token: unknown, clientKey: string): Promise<SigninResult> {
  const log = deps.log ?? defaultLog;
  if (!isTokenShaped(token)) return { status: "invalid" };

  let consumed: { status: ClaimStatus; userId?: string } | null;
  try {
    const { data, error } = await deps.admin.rpc("assisted_signin_consume", {
      p_token_hash: hashToken(token),
      p_client_key: clientKey,
    });
    if (error) {
      log("consume failed", error.code);
      return { status: "error" };
    }
    consumed = consumeAnswer(data);
  } catch {
    log("consume threw");
    return { status: "error" };
  }
  if (!consumed) {
    log("consume returned no usable answer");
    return { status: "error" };
  }
  if (consumed.status !== "ok") return { status: consumed.status };
  const userId = consumed.userId!;

  // From here the token is used up. Nothing below writes a session until
  // verifyOtp, so a failure before it leaves an existing session as it was.
  const fail = (label: string, code?: string): SigninResult => {
    log(label, code);
    return { status: "error" };
  };

  let hashed: string;
  try {
    const found = await deps.admin.auth.admin.getUserById(userId);
    if (found.error) return fail("get user failed", found.error.code);
    const user = found.data?.user;
    if (!user || user.id !== userId) return fail("user not found");
    if (!isPlaceholderEmail(user.email)) return fail("not an assisted account");

    const link = await deps.admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
    const linkHash = link.data?.properties?.hashed_token;
    if (link.error || !linkHash) return fail("generate link failed", link.error?.code);
    hashed = linkHash;
  } catch {
    return fail("sign-in threw before verify");
  }

  let verified: { error: AuthError };
  try {
    verified = await deps.session.auth.verifyOtp({ token_hash: hashed, type: "magiclink" });
  } catch {
    // Past auth-js's own error handling: the new session may be partly written. Remove it.
    log("verify otp threw");
    try {
      await deps.clearAuthCookies();
    } catch {
      log("clearing cookies after verify threw also threw");
    }
    return { status: "error" };
  }
  // An auth error: nothing was saved, so an existing session stays as it was.
  if (verified.error) return fail("verify otp failed", verified.error.code);
  return { status: "ok" };
}

export async function handleSigninRequest(request: Request, deps: SigninDeps, secret: string): Promise<Response> {
  const token = await tokenFromRequest(request);
  const result = await signInAssistedOwner(deps, token, clientKeyFor(callerIp(request.headers), secret));
  return claimResponse(result);
}

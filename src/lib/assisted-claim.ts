import { createHash, createHmac, randomUUID } from "node:crypto";
import { PRIVACY_POLICY_VERSION } from "./privacy-consent.ts";

/**
 * The owner side of assisted onboarding: HQ (Boss) set up a shop as a draft
 * and sent the owner a link, https://partners.kopi-boy.com/claim#<token>.
 * The /claim page posts the token to /api/claim/preview and, on the owner's
 * tap, /api/claim/complete. Both routes call the service-role-only SQL in
 * kopi-boy-boss/docs/supabase-assisted-onboarding.sql (section 7).
 *
 * Never log, store or return the raw token or its hash. Logs here carry a
 * fixed label and at most a Postgres / auth error code.
 *
 * Everything that talks to Supabase is passed in (ClaimDeps), so the routes
 * can be tested with a fake client (assisted-claim.test.ts).
 */

export const CLAIM_STATUSES = ["ok", "invalid", "expired", "used", "revoked", "cancelled", "rate_limited"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
/** What the routes answer: the database statuses, or "error" for anything that went wrong on our side. */
export type ClaimResultStatus = ClaimStatus | "error";

/** The placeholder email domain: .invalid is reserved (RFC 2606), so no mail server can ever exist for it. */
export const PLACEHOLDER_EMAIL_DOMAIN = "assisted.invalid";

/** The raw token: 32 random bytes, base64url (43 chars). Anything outside this shape is never sent anywhere. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,128}$/;

export function isTokenShaped(token: unknown): token is string {
  return typeof token === "string" && TOKEN_SHAPE.test(token);
}

/** token_hash: lowercase hex SHA-256 of the token's UTF-8 bytes (what Boss stored). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** client_key: lowercase hex HMAC-SHA-256 of the caller's IP. The raw IP never leaves this server. */
export function clientKeyFor(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip, "utf8").digest("hex");
}

/**
 * The caller's IP. On Vercel, x-forwarded-for is set by the platform (a
 * client-sent value is overwritten), so its first entry is the real client.
 */
export function callerIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

export interface ClaimShop {
  business_name: string;
  category: string;
  cuisine_type: string;
  is_halal: boolean;
  description: string | null;
  hero_image: string | null;
  owner_name: string;
  owner_mobile_masked: string | null;
  business_uen: string | null;
  business_address: string | null;
  postal_code: string | null;
}

export interface ClaimItem {
  name: string;
  price: number;
  photo_url: string | null;
}

export type PreviewResult =
  | { status: "ok"; shop: ClaimShop; items: ClaimItem[]; expires_at: string | null }
  | { status: Exclude<ClaimResultStatus, "ok"> };

export type CompleteResult = { status: ClaimResultStatus };

type DbError = { code?: string; message?: string } | null;
type AuthError = { code?: string; status?: number; message?: string } | null;

/** The parts of the service-role client the claim uses. */
export interface AdminClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError }>;
  auth: {
    admin: {
      createUser(attrs: {
        email: string;
        email_confirm: boolean;
        app_metadata: Record<string, unknown>;
        user_metadata: Record<string, unknown>;
      }): Promise<{ data: { user: { id: string } | null }; error: AuthError }>;
      generateLink(params: {
        type: "magiclink";
        email: string;
      }): Promise<{ data: { properties: { hashed_token: string } | null } | null; error: AuthError }>;
      deleteUser(id: string): Promise<{ error: AuthError }>;
    };
  };
}

/** The cookie-writing server client (src/lib/supabase/server.ts): verifyOtp here sets the owner's session cookies. */
export interface SessionClient {
  auth: {
    verifyOtp(params: { token_hash: string; type: "magiclink" }): Promise<{ error: AuthError }>;
    signOut(options: { scope: "local" }): Promise<{ error: AuthError }>;
  };
}

export interface ClaimDeps {
  admin: AdminClient;
  session: SessionClient;
  /** Removes every Supabase auth cookie from the response. */
  clearAuthCookies: () => void | Promise<void>;
  log?: (label: string, code?: string) => void;
}

const defaultLog = (label: string, code?: string) => console.error(`claim: ${label}${code ? ` (${code})` : ""}`);

function statusFrom(data: unknown): ClaimStatus | null {
  const status = (data as { status?: unknown } | null)?.status;
  return typeof status === "string" && (CLAIM_STATUSES as readonly string[]).includes(status) ? (status as ClaimStatus) : null;
}

/** assisted_claim_preview, plus the shop_id the complete step needs (never sent to the browser). */
async function runPreview(
  deps: ClaimDeps,
  token: unknown,
  clientKey: string,
): Promise<(PreviewResult & { shopId?: string })> {
  const log = deps.log ?? defaultLog;
  if (!isTokenShaped(token)) return { status: "invalid" };
  const { data, error } = await deps.admin.rpc("assisted_claim_preview", {
    p_token_hash: hashToken(token),
    p_client_key: clientKey,
  });
  if (error) {
    log("preview failed", error.code);
    return { status: "error" };
  }
  const status = statusFrom(data);
  if (!status) {
    log("preview returned no status");
    return { status: "error" };
  }
  if (status !== "ok") return { status };
  const d = data as { shop_id?: string; shop?: ClaimShop; items?: ClaimItem[]; expires_at?: string | null };
  if (!d.shop_id || !d.shop) {
    log("preview returned no shop");
    return { status: "error" };
  }
  return {
    status: "ok",
    shopId: d.shop_id,
    shop: d.shop,
    items: Array.isArray(d.items) ? d.items : [],
    expires_at: d.expires_at ?? null,
  };
}

export async function previewClaim(deps: ClaimDeps, token: unknown, clientKey: string): Promise<PreviewResult> {
  const result = await runPreview(deps, token, clientKey);
  if (result.status !== "ok") return { status: result.status };
  const { shop, items, expires_at } = result;
  return { status: "ok", shop, items, expires_at };
}

/**
 * The owner's tap. Session first, so a finished claim never leaves the owner
 * signed out:
 *   1. preview again, must be ok
 *   2. create the auth user (placeholder email, no password, no phone)
 *   3. magic link → verifyOtp on the cookie client: the session cookies are set
 *   4. assisted_claim_complete
 * Any failure after step 2: sign out, clear the cookies, delete the user.
 */
export async function completeClaim(
  deps: ClaimDeps,
  token: unknown,
  clientKey: string,
  userAgent: string | null,
): Promise<CompleteResult> {
  const log = deps.log ?? defaultLog;

  const preview = await runPreview(deps, token, clientKey);
  if (preview.status !== "ok" || !preview.shopId) return { status: preview.status === "ok" ? "error" : preview.status };
  const tokenHash = hashToken(token as string);

  const email = `owner-${randomUUID()}@${PLACEHOLDER_EMAIL_DOMAIN}`;
  const created = await deps.admin.auth.admin
    .createUser({
      email,
      email_confirm: true,
      app_metadata: { kb_assisted_shop_id: preview.shopId },
      user_metadata: { full_name: preview.shop.owner_name },
    })
    .catch(() => ({ data: { user: null }, error: { code: "exception" } as AuthError }));
  const userId = created.data?.user?.id;
  if (created.error || !userId) {
    log("create user failed", created.error?.code);
    return { status: "error" };
  }

  const undo = async (status: ClaimResultStatus): Promise<CompleteResult> => {
    try {
      await deps.session.auth.signOut({ scope: "local" });
    } catch {
      log("sign out after failed claim threw");
    }
    try {
      await deps.clearAuthCookies();
    } catch {
      log("clearing cookies after failed claim threw");
    }
    try {
      const { error } = await deps.admin.auth.admin.deleteUser(userId);
      if (error) log("delete user after failed claim failed", error.code);
    } catch {
      log("delete user after failed claim threw");
    }
    return { status };
  };

  try {
    const link = await deps.admin.auth.admin.generateLink({ type: "magiclink", email });
    const hashed = link.data?.properties?.hashed_token;
    if (link.error || !hashed) {
      log("generate link failed", link.error?.code);
      return await undo("error");
    }

    const verified = await deps.session.auth.verifyOtp({ token_hash: hashed, type: "magiclink" });
    if (verified.error) {
      log("verify otp failed", verified.error.code);
      return await undo("error");
    }

    const { data, error } = await deps.admin.rpc("assisted_claim_complete", {
      p_token_hash: tokenHash,
      p_client_key: clientKey,
      p_user_id: userId,
      p_user_agent: userAgent ? userAgent.slice(0, 400) : null,
      p_privacy_policy_version: PRIVACY_POLICY_VERSION,
    });
    if (error) {
      log("complete failed", error.code);
      return await undo("error");
    }
    const status = statusFrom(data);
    if (status !== "ok") {
      if (!status) log("complete returned no status");
      return await undo(status ?? "error");
    }
    return { status: "ok" };
  } catch {
    log("claim threw");
    return await undo("error");
  }
}

/** HTTP status for a route answer: 429 for rate_limited, 500 for our own errors, else 200 (the body says what happened). */
export function httpStatusFor(status: ClaimResultStatus): number {
  if (status === "rate_limited") return 429;
  if (status === "error") return 500;
  return 200;
}

/** Reads { token } from a JSON body; anything else is "no token". */
export async function tokenFromRequest(request: Request): Promise<unknown> {
  try {
    const body = (await request.json()) as { token?: unknown } | null;
    return body?.token;
  } catch {
    return undefined;
  }
}

const NO_STORE = { "Cache-Control": "no-store" };

export function claimResponse(body: { status: ClaimResultStatus } & Record<string, unknown>): Response {
  return Response.json(body, { status: httpStatusFor(body.status), headers: NO_STORE });
}

/**
 * The secret for client_key. Missing or too short → the routes refuse to run
 * (503) rather than rate-limit everyone under one key.
 */
export function claimSecret(env: Record<string, string | undefined>): string | null {
  const secret = env.ASSISTED_CLAIM_IP_HMAC_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

export async function handlePreviewRequest(request: Request, deps: ClaimDeps, secret: string): Promise<Response> {
  const token = await tokenFromRequest(request);
  const result = await previewClaim(deps, token, clientKeyFor(callerIp(request.headers), secret));
  return claimResponse(result);
}

export async function handleCompleteRequest(request: Request, deps: ClaimDeps, secret: string): Promise<Response> {
  const token = await tokenFromRequest(request);
  const result = await completeClaim(
    deps,
    token,
    clientKeyFor(callerIp(request.headers), secret),
    request.headers.get("user-agent"),
  );
  return claimResponse(result);
}

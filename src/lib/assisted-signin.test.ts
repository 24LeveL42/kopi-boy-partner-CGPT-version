import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { clientKeyFor, type ClaimStatus } from "./assisted-claim.ts";
import { handleSigninRequest, isPlaceholderEmail, type SigninDeps } from "./assisted-signin.ts";
import { CLAIM_STATUS_COPY, RESUME_COPY, RESUME_NO_TOKEN_COPY, RESUME_STATUS_COPY } from "./claim-copy.ts";
import nextConfig from "../../next.config.ts";

const TOKEN = "c2lnbmluLXRva2VuLWZvci10ZXN0cy0xMjM0NTY3ODk"; // 43-char base64url, like Boss makes
const TOKEN_HASH = createHash("sha256").update(TOKEN, "utf8").digest("hex");
const SECRET = "test-secret-that-is-at-least-32-characters-long";
const IP = "203.0.113.9";
const USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const EMAIL = "owner-0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0@assisted.invalid";
const MAGIC_HASH = "magic-link-hashed-token";

type Call = { name: string; args: unknown };

interface FakeOptions {
  consume?: unknown;
  consumeError?: { code: string; message: string };
  consumeThrows?: boolean;
  getUser?: { id: string; email?: string | null } | null;
  getUserError?: boolean;
  getUserThrows?: boolean;
  generateLinkError?: boolean;
  noHashedToken?: boolean;
  verifyError?: boolean;
  verifyThrows?: boolean;
  /** The browser's cookies before the request: an existing session, by default. */
  cookies?: Record<string, string>;
}

const EXISTING_SESSION = { "sb-proj-auth-token": "existing-session-of-someone-signed-in" };

function fake(opts: FakeOptions = {}) {
  const calls: Call[] = [];
  // The response's cookie jar, as the cookie-writing client and clearAuthCookies see it.
  const jar = new Map(Object.entries(opts.cookies ?? EXISTING_SESSION));
  const deps: SigninDeps = {
    admin: {
      async rpc(name, args) {
        calls.push({ name: `rpc:${name}`, args });
        if (opts.consumeThrows) throw new Error(`network down for ${String((args as { p_token_hash: string }).p_token_hash)}`);
        if (opts.consumeError) return { data: null, error: opts.consumeError };
        return { data: "consume" in opts ? opts.consume : { status: "ok", user_id: USER_ID }, error: null };
      },
      auth: {
        admin: {
          async getUserById(id) {
            calls.push({ name: "getUserById", args: id });
            if (opts.getUserThrows) throw new Error(`boom ${EMAIL}`);
            if (opts.getUserError) return { data: { user: null }, error: { code: "user_not_found" } };
            return { data: { user: opts.getUser === undefined ? { id: USER_ID, email: EMAIL } : opts.getUser }, error: null };
          },
          async generateLink(params) {
            calls.push({ name: "generateLink", args: params });
            if (opts.generateLinkError) return { data: null, error: { code: "unexpected_failure" } };
            if (opts.noHashedToken) return { data: { properties: null }, error: null };
            return { data: { properties: { hashed_token: MAGIC_HASH } }, error: null };
          },
        },
      },
    },
    session: {
      auth: {
        async verifyOtp(params) {
          calls.push({ name: "verifyOtp", args: params });
          if (opts.verifyThrows) {
            jar.set("sb-proj-auth-token.0", "half-of-a-new-session"); // auth-js threw while saving
            throw new Error("storage failed");
          }
          if (opts.verifyError) return { error: { code: "otp_expired" } };
          jar.set("sb-proj-auth-token", "new-session-for-the-owner");
          return { error: null };
        },
      },
    },
    clearAuthCookies: () => {
      calls.push({ name: "clearAuthCookies", args: null });
      for (const name of [...jar.keys()]) if (name.startsWith("sb-")) jar.delete(name);
    },
  };
  // A user must never be made or removed: fail loudly if anything reaches for those.
  const admin = deps.admin.auth.admin as unknown as Record<string, unknown>;
  for (const forbidden of ["createUser", "deleteUser", "updateUserById", "inviteUserByEmail"]) {
    admin[forbidden] = () => {
      throw new Error(`${forbidden} must never be called`);
    };
  }
  return { deps, calls, jar, names: () => calls.map((c) => c.name) };
}

function request(body: unknown) {
  return new Request("https://partners.kopi-boy.com/api/claim/resume", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${IP}, 10.0.0.1`, "user-agent": "WhatsApp/2.24 iPhone" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function send(f: ReturnType<typeof fake>, body: unknown = { token: TOKEN }) {
  const res = await handleSigninRequest(request(body), f.deps, SECRET);
  return { res, body: await res.json() };
}

// Everything written to the console: never the token, its hash, the IP, the user id or the email.
let logged: string[] = [];
const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
beforeEach(() => {
  logged = [];
  for (const k of Object.keys(originals) as (keyof typeof originals)[]) {
    console[k] = (...args: unknown[]) => {
      logged.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
  }
});
afterEach(() => {
  Object.assign(console, originals);
  const all = logged.join("\n");
  for (const [secret, what] of [[TOKEN, "token"], [TOKEN_HASH, "token hash"], [IP, "raw IP"], [USER_ID, "user id"], [EMAIL, "email"]]) {
    assert.ok(!all.includes(secret), `the ${what} was logged`);
  }
});

const NON_OK: Exclude<ClaimStatus, "ok">[] = ["invalid", "expired", "used", "revoked", "cancelled", "rate_limited"];

describe("POST /api/claim/resume", () => {
  it("ok: consume, look up that existing user, magic link, verifyOtp — nothing made, deleted or cleared", async () => {
    const f = fake();
    const { res, body } = await send(f);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(body, { status: "ok" });
    assert.deepEqual(f.names(), ["rpc:assisted_signin_consume", "getUserById", "generateLink", "verifyOtp"]);
    assert.deepEqual(f.calls[0].args, { p_token_hash: TOKEN_HASH, p_client_key: clientKeyFor(IP, SECRET) });
    assert.equal(f.calls[1].args, USER_ID);
    assert.deepEqual(f.calls[2].args, { type: "magiclink", email: EMAIL });
    assert.deepEqual(f.calls[3].args, { token_hash: MAGIC_HASH, type: "magiclink" });
  });

  it("the answer never carries the user id, the email or the hash", async () => {
    const { body } = await send(fake());
    const text = JSON.stringify(body);
    for (const s of [USER_ID, EMAIL, TOKEN_HASH, MAGIC_HASH]) assert.equal(text.includes(s), false);
  });

  for (const status of NON_OK) {
    it(`${status}: passed through${status === "rate_limited" ? " with HTTP 429" : ""}, no user looked up, cookies untouched`, async () => {
      const f = fake({ consume: { status } });
      const { res, body } = await send(f);
      assert.equal(res.status, status === "rate_limited" ? 429 : 200);
      assert.deepEqual(body, { status });
      assert.deepEqual(f.names(), ["rpc:assisted_signin_consume"]);
      assert.deepEqual(Object.fromEntries(f.jar), EXISTING_SESSION);
    });
  }

  it("an already signed-in browser taps a used link and stays signed in", async () => {
    const f = fake({ consume: { status: "used" } });
    const { res, body } = await send(f);
    assert.equal(res.status, 200);
    assert.deepEqual(body, { status: "used" });
    assert.deepEqual(Object.fromEntries(f.jar), EXISTING_SESSION, "the existing session cookie must survive");
    assert.equal(f.names().includes("clearAuthCookies"), false);
    assert.equal(f.names().includes("verifyOtp"), false);
    assert.equal(res.headers.get("set-cookie"), null, "the answer must not touch cookies");
  });

  it("ok: the owner's new session replaces what was there", async () => {
    const f = fake();
    await send(f);
    assert.deepEqual(Object.fromEntries(f.jar), { "sb-proj-auth-token": "new-session-for-the-owner" });
  });

  it("a missing, malformed or oversized token is invalid without reaching the database", async () => {
    for (const b of [{}, { token: "" }, { token: 42 }, { token: "has spaces and !!" }, { token: "a".repeat(500) }, "not json"]) {
      const f = fake();
      const { body } = await send(f, b);
      assert.deepEqual(body, { status: "invalid" });
      assert.equal(f.calls.length, 0);
    }
  });

  it("a database error is a 500 'error', logged with its code only, cookies untouched (token not used up)", async () => {
    const f = fake({ consumeError: { code: "42501", message: `permission denied, hash ${TOKEN_HASH}` } });
    const { res, body } = await send(f);
    assert.equal(res.status, 500);
    assert.deepEqual(body, { status: "error" });
    assert.deepEqual(f.names(), ["rpc:assisted_signin_consume"]);
    assert.ok(logged.some((l) => l.includes("42501")));
  });

  it("the consume call throws (network): 500, nothing logged but a label", async () => {
    const f = fake({ consumeThrows: true });
    const { res } = await send(f);
    assert.equal(res.status, 500);
    assert.deepEqual(f.names(), ["rpc:assisted_signin_consume"]);
  });

  it("an unknown status, or ok without a proper user id, is an error and signs nobody in", async () => {
    for (const consume of [{ status: "weird" }, null, { status: "ok" }, { status: "ok", user_id: "not-a-uuid" }, { status: "ok", user_id: 7 }]) {
      const f = fake({ consume });
      const { res } = await send(f);
      assert.equal(res.status, 500);
      assert.deepEqual(f.names(), ["rpc:assisted_signin_consume"]);
    }
  });

  // After an ok consume, every failure before a new session is written keeps the existing one.
  const KEEPS = "keeps the existing session";
  const keeps = (f: ReturnType<typeof fake>) => {
    assert.equal(f.names().includes("clearAuthCookies"), false);
    assert.deepEqual(Object.fromEntries(f.jar), EXISTING_SESSION);
  };

  it(`looking up the user fails: 500, never a magic link, ${KEEPS}`, async () => {
    const f = fake({ getUserError: true });
    const { res } = await send(f);
    assert.equal(res.status, 500);
    assert.deepEqual(f.names(), ["rpc:assisted_signin_consume", "getUserById"]);
    keeps(f);
  });

  it(`the user no longer exists, or a different id comes back: 500, ${KEEPS}`, async () => {
    for (const getUser of [null, { id: "00000000-0000-4000-8000-000000000000", email: EMAIL }]) {
      const f = fake({ getUser });
      const { res } = await send(f);
      assert.equal(res.status, 500);
      assert.deepEqual(f.names(), ["rpc:assisted_signin_consume", "getUserById"]);
      keeps(f);
    }
  });

  it(`refuses an account that isn't an assisted placeholder (a real email, Google, no email): never a magic link, ${KEEPS}`, async () => {
    for (const email of ["owner@gmail.com", "someone@assisted.invalid.example.com", "owner-x@assisted.invalid", null, undefined, ""]) {
      const f = fake({ getUser: { id: USER_ID, email } });
      const { res } = await send(f);
      assert.equal(res.status, 500);
      assert.deepEqual(f.names(), ["rpc:assisted_signin_consume", "getUserById"]);
      keeps(f);
    }
    assert.ok(logged.some((l) => l.includes("not an assisted account")));
  });

  it(`looking up the user throws: 500, the error text (with the email) is not logged, ${KEEPS}`, async () => {
    const f = fake({ getUserThrows: true });
    const { res } = await send(f);
    assert.equal(res.status, 500);
    assert.deepEqual(f.names(), ["rpc:assisted_signin_consume", "getUserById"]);
    keeps(f);
  });

  it(`the magic link fails or has no hashed token: never verifies, ${KEEPS}`, async () => {
    for (const opts of [{ generateLinkError: true }, { noHashedToken: true }]) {
      const f = fake(opts);
      const { res } = await send(f);
      assert.equal(res.status, 500);
      assert.deepEqual(f.names(), ["rpc:assisted_signin_consume", "getUserById", "generateLink"]);
      keeps(f);
    }
  });

  it(`verifyOtp returns an error (auth-js saved nothing): 500, ${KEEPS}`, async () => {
    const f = fake({ verifyError: true });
    const { res } = await send(f);
    assert.equal(res.status, 500);
    assert.deepEqual(f.names(), ["rpc:assisted_signin_consume", "getUserById", "generateLink", "verifyOtp"]);
    keeps(f);
  });

  it("verifyOtp throws while saving the new session: clears the half-written cookies, 500", async () => {
    const f = fake({ verifyThrows: true });
    const { res, body } = await send(f);
    assert.equal(res.status, 500);
    assert.deepEqual(body, { status: "error" });
    assert.deepEqual(f.names(), ["rpc:assisted_signin_consume", "getUserById", "generateLink", "verifyOtp", "clearAuthCookies"]);
    assert.equal([...f.jar.keys()].some((k) => k.startsWith("sb-")), false);
  });

  it("verifyOtp throws and the cookie wipe throws too: still answers 'error'", async () => {
    const f = fake({ verifyThrows: true });
    f.deps.clearAuthCookies = () => {
      throw new Error("cookies");
    };
    const { res, body } = await send(f);
    assert.equal(res.status, 500);
    assert.deepEqual(body, { status: "error" });
  });

  it("a database error, a malformed token or a non-ok answer never reaches the cookie wipe", async () => {
    for (const f of [fake({ consumeError: { code: "XX000", message: "x" } }), fake({ consumeThrows: true }), fake({ consume: { status: "weird" } })]) {
      await send(f);
      keeps(f);
    }
    const malformed = fake();
    await send(malformed, { token: "x" });
    keeps(malformed);
  });
});

describe("placeholder email check", () => {
  it("accepts only owner-<uuid>@assisted.invalid, any case", () => {
    assert.equal(isPlaceholderEmail(EMAIL), true);
    assert.equal(isPlaceholderEmail(EMAIL.toUpperCase()), true);
    for (const e of ["owner@gmail.com", `x${EMAIL}`, `${EMAIL}.com`, "owner-@assisted.invalid", null, 42]) {
      assert.equal(isPlaceholderEmail(e), false, String(e));
    }
  });
});

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("/resume page and route", () => {
  it("the route exports POST only (any other method gets 405), through the claim route helper", () => {
    const src = read("src/app/api/claim/resume/route.ts");
    assert.deepEqual([...src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map((m) => m[1]), ["POST"]);
    assert.match(src, /from "@\/lib\/claim-route"/);
  });

  it("the page is static, not indexed, and sets no-referrer as a meta tag", () => {
    const src = read("src/app/resume/page.tsx");
    assert.match(src, /dynamic = "force-static"/);
    assert.match(src, /referrer: "no-referrer"/);
    assert.match(src, /index: false/);
  });

  it("the page is also served with a Referrer-Policy: no-referrer header", async () => {
    const rules = await nextConfig.headers!();
    const rule = rules.find((r) => r.source === "/resume");
    assert.ok(rule);
    assert.deepEqual(rule.headers, [{ key: "Referrer-Policy", value: "no-referrer" }]);
  });

  it("the page posts the token only from the button, never on load, and clears the # first", () => {
    const src = read("src/components/ResumeFlow.tsx");
    const effect = src.slice(src.indexOf("useEffect(() => {"), src.indexOf("}, []);"));
    assert.ok(effect.length > 0);
    assert.equal(effect.includes("fetch("), false, "the page must not send anything on load");
    assert.match(effect, /history\.replaceState/);
    assert.equal(src.match(/fetch\(/g)?.length, 1);
    assert.match(src.slice(src.indexOf("async function signIn")), /^async function signIn\(\) \{[\s\S]*?fetch\("\/api\/claim\/resume", \{\s*method: "POST"/);
    assert.match(src, /onClick=\{signIn\}/);
    assert.equal(/console\./.test(src), false);
  });
});

describe("sign-in link wording", () => {
  it("the claim's 'already used' message tells a signed-out owner HQ can send a sign-in link", () => {
    assert.equal(
      CLAIM_STATUS_COPY.used.message,
      "This shop has already been claimed. If that was you and you are now signed out, ask Kopi Boy to send you a sign-in link on WhatsApp.",
    );
  });

  it("/resume has a message for every non-ok status, and its own button", () => {
    for (const s of [...NON_OK, "error"] as const) {
      assert.ok(RESUME_STATUS_COPY[s].title && RESUME_STATUS_COPY[s].message, s);
    }
    assert.equal(RESUME_COPY.button, "Sign me in");
    assert.match(RESUME_NO_TOKEN_COPY.message, /sign-in link Kopi Boy sent you on WhatsApp/);
  });

  it("an error says nothing in the shop changed and points to a new sign-in link (the old one may be used up)", () => {
    assert.match(RESUME_STATUS_COPY.error.message, /nothing in your shop was changed/);
    assert.match(RESUME_STATUS_COPY.error.message, /new sign-in link/);
  });
});

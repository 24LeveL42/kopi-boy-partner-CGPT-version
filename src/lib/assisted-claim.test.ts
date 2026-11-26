import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import {
  CLAIM_STATUSES,
  callerIp,
  claimSecret,
  clientKeyFor,
  handleCompleteRequest,
  handlePreviewRequest,
  hashToken,
  PLACEHOLDER_EMAIL_DOMAIN,
  type ClaimDeps,
  type ClaimStatus,
} from "./assisted-claim.ts";
import { PRIVACY_POLICY_VERSION } from "./privacy-consent.ts";

const TOKEN = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWpr"; // 43-char base64url, like Boss makes
const TOKEN_HASH = createHash("sha256").update(TOKEN, "utf8").digest("hex");
const SECRET = "test-secret-that-is-at-least-32-characters-long";
const IP = "203.0.113.7";
const SHOP_ID = "11111111-2222-3333-4444-555555555555";
const NEW_USER_ID = "99999999-8888-7777-6666-555555555555";
const MAGIC_HASH = "magic-link-hashed-token";

const OK_PREVIEW = {
  status: "ok",
  shop_id: SHOP_ID,
  expires_at: "2026-11-27T00:00:00Z",
  shop: {
    business_name: "Ah Hock Chicken Rice",
    category: "hawker",
    cuisine_type: "chinese",
    is_halal: false,
    description: null,
    hero_image: null,
    owner_name: "Tan Ah Hock",
    owner_mobile_masked: "••••1234",
    business_uen: null,
    business_address: "Blk 1 Hawker Centre",
    postal_code: "123456",
  },
  items: [{ name: "Chicken Rice", price: 4.5, photo_url: null }],
};

type Call = { name: string; args: unknown };

interface FakeOptions {
  preview?: unknown[]; // one answer per preview call, in order
  previewError?: { code: string; message: string };
  complete?: unknown;
  completeError?: { code: string; message: string };
  completeThrows?: boolean;
  createUserError?: boolean;
  generateLinkError?: boolean;
  verifyError?: boolean;
}

function fake(opts: FakeOptions = {}) {
  const calls: Call[] = [];
  const previews = [...(opts.preview ?? [OK_PREVIEW, OK_PREVIEW])];
  const deps: ClaimDeps = {
    admin: {
      async rpc(name, args) {
        calls.push({ name: `rpc:${name}`, args });
        if (name === "assisted_claim_preview") {
          if (opts.previewError) return { data: null, error: opts.previewError };
          return { data: previews.shift() ?? OK_PREVIEW, error: null };
        }
        if (opts.completeThrows) throw new Error(`network down for ${String((args as { p_token_hash: string }).p_token_hash)}`);
        if (opts.completeError) return { data: null, error: opts.completeError };
        return { data: opts.complete ?? { status: "ok", kitchen_id: NEW_USER_ID }, error: null };
      },
      auth: {
        admin: {
          async createUser(attrs) {
            calls.push({ name: "createUser", args: attrs });
            if (opts.createUserError) return { data: { user: null }, error: { code: "email_exists", message: "nope" } };
            return { data: { user: { id: NEW_USER_ID } }, error: null };
          },
          async generateLink(params) {
            calls.push({ name: "generateLink", args: params });
            if (opts.generateLinkError) return { data: null, error: { code: "unexpected_failure" } };
            return { data: { properties: { hashed_token: MAGIC_HASH } }, error: null };
          },
          async deleteUser(id) {
            calls.push({ name: "deleteUser", args: id });
            return { error: null };
          },
        },
      },
    },
    session: {
      auth: {
        async verifyOtp(params) {
          calls.push({ name: "verifyOtp", args: params });
          return { error: opts.verifyError ? { code: "otp_expired" } : null };
        },
        async signOut(options) {
          calls.push({ name: "signOut", args: options });
          return { error: null };
        },
      },
    },
    clearAuthCookies: () => {
      calls.push({ name: "clearAuthCookies", args: null });
    },
  };
  return { deps, calls, names: () => calls.map((c) => c.name) };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://partners.kopi-boy.com/api/claim/x", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${IP}, 10.0.0.1`, "user-agent": "WhatsApp/2.24 iPhone", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// Everything written to the console during a test, to prove the token and its hash never are.
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
  assert.ok(!all.includes(TOKEN), "the token was logged");
  assert.ok(!all.includes(TOKEN_HASH), "the token hash was logged");
  assert.ok(!all.includes(IP), "the raw IP was logged");
});

const NON_OK: Exclude<ClaimStatus, "ok">[] = ["invalid", "expired", "used", "revoked", "cancelled", "rate_limited"];

describe("hashing", () => {
  it("token_hash is lowercase hex SHA-256 of the UTF-8 token", () => {
    assert.equal(hashToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.equal(hashToken(TOKEN), TOKEN_HASH);
  });

  it("client_key is lowercase hex HMAC-SHA-256 of the IP, never the IP", () => {
    const key = clientKeyFor(IP, SECRET);
    assert.equal(key, createHmac("sha256", SECRET).update(IP).digest("hex"));
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.ok(!key.includes(IP));
    assert.notEqual(clientKeyFor(IP, `${SECRET}x`), key);
  });

  it("takes the first x-forwarded-for entry, then x-real-ip", () => {
    assert.equal(callerIp(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })), "1.2.3.4");
    assert.equal(callerIp(new Headers({ "x-real-ip": "9.9.9.9" })), "9.9.9.9");
    assert.equal(callerIp(new Headers()), "unknown");
  });

  it("refuses a missing or short HMAC secret", () => {
    assert.equal(claimSecret({}), null);
    assert.equal(claimSecret({ ASSISTED_CLAIM_IP_HMAC_SECRET: "short" }), null);
    assert.equal(claimSecret({ ASSISTED_CLAIM_IP_HMAC_SECRET: ` ${SECRET} ` }), SECRET);
  });
});

describe("POST /api/claim/preview", () => {
  it("ok: sends the hash and HMAC key, returns the shop and menu without the shop id", async () => {
    const f = fake();
    const res = await handlePreviewRequest(request({ token: TOKEN }), f.deps, SECRET);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.shop.business_name, "Ah Hock Chicken Rice");
    assert.deepEqual(body.items, OK_PREVIEW.items);
    assert.equal(body.shop_id, undefined);
    assert.equal(JSON.stringify(body).includes(TOKEN_HASH), false);
    assert.deepEqual(f.calls[0], {
      name: "rpc:assisted_claim_preview",
      args: { p_token_hash: TOKEN_HASH, p_client_key: clientKeyFor(IP, SECRET) },
    });
  });

  for (const status of NON_OK) {
    it(`${status}: passes the status through${status === "rate_limited" ? " with HTTP 429" : ""}`, async () => {
      const f = fake({ preview: [{ status }] });
      const res = await handlePreviewRequest(request({ token: TOKEN }), f.deps, SECRET);
      assert.equal(res.status, status === "rate_limited" ? 429 : 200);
      assert.deepEqual(await res.json(), { status });
      assert.deepEqual(f.names(), ["rpc:assisted_claim_preview"]);
    });
  }

  it("a missing, malformed or oversized token is invalid without reaching the database", async () => {
    for (const body of [{}, { token: "" }, { token: 42 }, { token: "has spaces and !!" }, { token: "a".repeat(500) }, "not json"]) {
      const f = fake();
      const res = await handlePreviewRequest(request(body), f.deps, SECRET);
      assert.deepEqual(await res.json(), { status: "invalid" });
      assert.equal(f.calls.length, 0);
    }
  });

  it("a database error is a 500 'error', logged with its code only", async () => {
    const f = fake({ previewError: { code: "42501", message: `permission denied, hash ${TOKEN_HASH}` } });
    const res = await handlePreviewRequest(request({ token: TOKEN }), f.deps, SECRET);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { status: "error" });
    assert.ok(logged.some((l) => l.includes("42501")));
  });

  it("an unknown status from the database is an error", async () => {
    const f = fake({ preview: [{ status: "weird" }] });
    const res = await handlePreviewRequest(request({ token: TOKEN }), f.deps, SECRET);
    assert.equal(res.status, 500);
  });
});

describe("POST /api/claim/complete", () => {
  it("ok: preview, create user, sign in, then claim — in that order, nothing deleted", async () => {
    const f = fake();
    const res = await handleCompleteRequest(request({ token: TOKEN }), f.deps, SECRET);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
    assert.deepEqual(f.names(), ["rpc:assisted_claim_preview", "createUser", "generateLink", "verifyOtp", "rpc:assisted_claim_complete"]);

    const created = f.calls[1].args as Record<string, unknown>;
    assert.match(String(created.email), new RegExp(`^owner-[0-9a-f-]{36}@${PLACEHOLDER_EMAIL_DOMAIN.replace(".", "\\.")}$`));
    assert.equal(created.email_confirm, true);
    assert.deepEqual(created.app_metadata, { kb_assisted_shop_id: SHOP_ID });
    assert.deepEqual(created.user_metadata, { full_name: "Tan Ah Hock" });
    assert.equal("password" in created, false);
    assert.equal("phone" in created, false);

    assert.deepEqual(f.calls[2].args, { type: "magiclink", email: created.email });
    assert.deepEqual(f.calls[3].args, { token_hash: MAGIC_HASH, type: "magiclink" });
    assert.deepEqual(f.calls[4].args, {
      p_token_hash: TOKEN_HASH,
      p_client_key: clientKeyFor(IP, SECRET),
      p_user_id: NEW_USER_ID,
      p_user_agent: "WhatsApp/2.24 iPhone",
      p_privacy_policy_version: "2026-11-pilot",
    });
    assert.equal(PRIVACY_POLICY_VERSION, "2026-11-pilot");
  });

  for (const status of NON_OK) {
    it(`preview says ${status}: no account is made`, async () => {
      const f = fake({ preview: [{ status }] });
      const res = await handleCompleteRequest(request({ token: TOKEN }), f.deps, SECRET);
      assert.equal(res.status, status === "rate_limited" ? 429 : 200);
      assert.deepEqual(await res.json(), { status });
      assert.deepEqual(f.names(), ["rpc:assisted_claim_preview"]);
    });

    it(`claim says ${status}: signs out, clears cookies and deletes the new user`, async () => {
      const f = fake({ complete: { status } });
      const res = await handleCompleteRequest(request({ token: TOKEN }), f.deps, SECRET);
      assert.equal(res.status, status === "rate_limited" ? 429 : 200);
      assert.deepEqual(await res.json(), { status });
      assert.deepEqual(f.names().slice(-3), ["signOut", "clearAuthCookies", "deleteUser"]);
      assert.equal(f.calls.at(-1)?.args, NEW_USER_ID);
    });
  }

  it("claim raises (wrong account, trigger failure): cleans up, 500", async () => {
    const f = fake({ completeError: { code: "42501", message: "assisted_claim: the account was not made for this shop" } });
    const res = await handleCompleteRequest(request({ token: TOKEN }), f.deps, SECRET);
    assert.equal(res.status, 500);
    assert.deepEqual(f.names().slice(-3), ["signOut", "clearAuthCookies", "deleteUser"]);
  });

  it("claim call throws (network): cleans up, and the error message with the hash is not logged", async () => {
    const f = fake({ completeThrows: true });
    const res = await handleCompleteRequest(request({ token: TOKEN }), f.deps, SECRET);
    assert.equal(res.status, 500);
    assert.ok(f.names().includes("deleteUser"));
  });

  it("magic link fails: never signs in or claims, deletes the user", async () => {
    const f = fake({ generateLinkError: true });
    await handleCompleteRequest(request({ token: TOKEN }), f.deps, SECRET);
    assert.deepEqual(f.names(), ["rpc:assisted_claim_preview", "createUser", "generateLink", "signOut", "clearAuthCookies", "deleteUser"]);
  });

  it("sign-in fails: never claims, deletes the user", async () => {
    const f = fake({ verifyError: true });
    await handleCompleteRequest(request({ token: TOKEN }), f.deps, SECRET);
    assert.equal(f.names().includes("rpc:assisted_claim_complete"), false);
    assert.deepEqual(f.names().slice(-3), ["signOut", "clearAuthCookies", "deleteUser"]);
  });

  it("creating the user fails: nothing to delete, cookies untouched", async () => {
    const f = fake({ createUserError: true });
    const res = await handleCompleteRequest(request({ token: TOKEN }), f.deps, SECRET);
    assert.equal(res.status, 500);
    assert.deepEqual(f.names(), ["rpc:assisted_claim_preview", "createUser"]);
  });

  it("a malformed token makes no account", async () => {
    const f = fake();
    const res = await handleCompleteRequest(request({ token: "x" }), f.deps, SECRET);
    assert.deepEqual(await res.json(), { status: "invalid" });
    assert.equal(f.calls.length, 0);
  });

  it("every status the SQL can return is handled", () => {
    assert.deepEqual([...CLAIM_STATUSES].sort(), ["cancelled", "expired", "invalid", "ok", "rate_limited", "revoked", "used"]);
  });
});

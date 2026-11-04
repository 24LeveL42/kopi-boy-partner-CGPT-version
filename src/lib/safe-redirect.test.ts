import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { safeRedirectPath } from "./safe-redirect.ts";

const ORIGIN = "https://partner.kopiboy.example";

const ATTACKS: string[] = [
  // protocol-relative
  "//evil.com",
  "///evil.com",
  "////evil.com",
  "//evil.com/orders",
  "/\\evil.com",
  "/\\/evil.com",
  "\\\\evil.com",
  "\\/evil.com",
  // userinfo trick: `${origin}@evil.com`
  "@evil.com",
  "/@evil.com",
  "/orders@evil.com",
  // absolute URLs and schemes
  "https://evil.com",
  "http://evil.com",
  "HTTPS://evil.com",
  "https:evil.com",
  "ftp://evil.com",
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "/javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "evil.com",
  "orders",
  ".evil.com",
  // whitespace and control characters
  " //evil.com",
  "/ /evil.com",
  "\t//evil.com",
  "/\t/evil.com",
  "/\n/evil.com",
  "/\r\n/evil.com",
  "/\0/evil.com",
  "/orders\n",
  "/orders path",
  "/ /evil.com",
  "/ /evil.com",
  "/　evil.com",
  // non-ASCII look-alikes
  "/／evil.com",
  "/∕evil.com",
  // single-encoded
  "%2F%2Fevil.com",
  "/%2Fevil.com",
  "/%2fevil.com",
  "/%5Cevil.com",
  "/%5cevil.com",
  "%40evil.com",
  "/%40evil.com",
  "https%3A%2F%2Fevil.com",
  "/%09/evil.com",
  "/%0A/evil.com",
  "/%0D%0A/evil.com",
  "/%20/evil.com",
  "/%00/evil.com",
  "javascript%3Aalert(1)",
  // double- and triple-encoded
  "%252F%252Fevil.com",
  "/%252Fevil.com",
  "/%255Cevil.com",
  "/%2540evil.com",
  "/%250A/evil.com",
  "/%25252Fevil.com",
  // malformed encoding
  "/%",
  "/%E0%A4%A",
  "/%zz",
  // empty
  "",
];

const VALID: string[] = [
  "/",
  "/orders",
  "/kitchen",
  "/account",
  "/notifications",
  "/promotions",
  "/promotions/new",
  "/promotions/7f0c1d2e-0000-4000-8000-000000000001",
  "/orders?tab=active",
  "/orders?tab=active&page=2",
  "/kitchen#menu",
  "/a/b/c",
];

describe("safeRedirectPath", () => {
  it("has at least 40 attack strings", () => {
    assert.ok(ATTACKS.length >= 40, `only ${ATTACKS.length}`);
  });

  for (const attack of ATTACKS) {
    it(`rejects ${JSON.stringify(attack)}`, () => {
      assert.equal(safeRedirectPath(attack), "/");
      assert.equal(safeRedirectPath(attack, "/login"), "/login");
    });
  }

  for (const path of VALID) {
    it(`accepts ${JSON.stringify(path)} unchanged`, () => {
      assert.equal(safeRedirectPath(path, "/fallback"), path);
    });
  }

  it("refuses an encoded space (decoded layers are checked too)", () => {
    assert.equal(safeRedirectPath("/orders%20today"), "/");
  });

  it("falls back for non-strings, null and over-long values", () => {
    assert.equal(safeRedirectPath(null), "/");
    assert.equal(safeRedirectPath(undefined), "/");
    assert.equal(safeRedirectPath(42), "/");
    assert.equal(safeRedirectPath(["/orders"]), "/");
    assert.equal(safeRedirectPath("/" + "a".repeat(5000)), "/");
  });

  it("refuses something still encoded after 5 decodes", () => {
    let v = "/x";
    for (let i = 0; i < 7; i++) v = encodeURIComponent(v);
    assert.equal(safeRedirectPath("/" + v), "/");
  });

  it("anything it returns stays on our origin with the callback's old `${origin}${next}` build and with new URL()", () => {
    for (const value of [...ATTACKS, ...VALID]) {
      const path = safeRedirectPath(value);
      assert.equal(new URL(`${ORIGIN}${path}`).origin, ORIGIN, value);
      assert.equal(new URL(path, ORIGIN).origin, ORIGIN, value);
    }
  });

  it("the original bug: next=@evil.com no longer leaves the site", () => {
    assert.equal(new URL(`${ORIGIN}@evil.com`).host, "evil.com"); // what the old code did
    assert.equal(new URL(safeRedirectPath("@evil.com"), ORIGIN).host, new URL(ORIGIN).host);
  });
});

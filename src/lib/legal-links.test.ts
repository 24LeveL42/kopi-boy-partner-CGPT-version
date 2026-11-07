import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LEGAL_ENTITY_LINE, LEGAL_LINKS, NEW_TAB, PRIVACY_URL, TERMS_URL } from "./legal-links.ts";
import { PRIVACY_POLICY_URL } from "./privacy-consent.ts";

describe("legal links", () => {
  it("point at the Customer app's public pages", () => {
    assert.equal(TERMS_URL, "https://kopi-boy.com/terms");
    assert.equal(PRIVACY_URL, "https://kopi-boy.com/privacy");
    assert.deepEqual(LEGAL_LINKS, [
      { label: "Terms of Use", href: "https://kopi-boy.com/terms" },
      { label: "Privacy Policy", href: "https://kopi-boy.com/privacy" },
    ]);
  });

  it("open in a new tab without an opener", () => {
    assert.deepEqual(NEW_TAB, { target: "_blank", rel: "noopener noreferrer" });
  });

  it("the application's privacy link uses the same URL", () => {
    assert.equal(PRIVACY_POLICY_URL, PRIVACY_URL);
  });

  it("shows the legal entity line, with no GST or tax wording", () => {
    assert.equal(LEGAL_ENTITY_LINE, "KOPIE BOY (UEN 53535194A), trading as Kopi Boy");
    assert.doesNotMatch(LEGAL_ENTITY_LINE, /gst|tax/i);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseInline, parseLegalMarkdown } from "./legal-markdown.ts";
import { CLAIM_STATUS_COPY, canClaimShop, claimStatement, formatPrice, NO_TOKEN_COPY, PARTNER_TERMS_SENTENCE } from "./claim-copy.ts";
import { KITCHEN_TERMS } from "./kitchen-profile.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (doc: string) => readFileSync(path.join(ROOT, "src", "content", "legal", `${doc}.md`), "utf8");

describe("legal texts copied into the Partner app", () => {
  for (const doc of ["terms", "privacy"]) {
    it(`${doc}.md is present, LF only, and parses into headed sections`, () => {
      const source = read(doc);
      assert.equal(source.includes("\r"), false);
      const blocks = parseLegalMarkdown(source);
      assert.equal(blocks[0].kind, "h1");
      assert.ok(blocks.filter((b) => b.kind === "h2").length >= 5);
    });
  }

  it("the parser keeps every word", () => {
    assert.deepEqual(parseInline("We **do not sell** data, see [here](/x)."), [
      { kind: "text", text: "We " },
      { kind: "bold", text: "do not sell" },
      { kind: "text", text: " data, see " },
      { kind: "link", text: "here", href: "/x" },
      { kind: "text", text: "." },
    ]);
  });
});

describe("claim wording", () => {
  it("the statement above the button names the shop, word for word", () => {
    assert.equal(
      claimStatement("Ah Hock Chicken Rice"),
      "By tapping I acknowledge, you claim Ah Hock Chicken Rice as its owner and agree to Kopi Boy's Terms of Use and Privacy Policy above. You are responsible for food safety, hygiene, pricing and the orders you accept. Kopi Boy doesn't process payments.",
    );
  });

  it("uses the same partner terms sentence as Kitchen Setup", () => {
    assert.equal(PARTNER_TERMS_SENTENCE, KITCHEN_TERMS);
  });

  it("has a friendly message for every non-ok status", () => {
    for (const s of ["invalid", "expired", "used", "revoked", "cancelled", "rate_limited", "error"] as const) {
      assert.ok(CLAIM_STATUS_COPY[s].title && CLAIM_STATUS_COPY[s].message);
    }
    assert.equal(CLAIM_STATUS_COPY.expired.message, "This link has expired, ask Kopi Boy for a new link.");
  });

  it("no link in the address: tells the owner to open the WhatsApp link again, word for word", () => {
    assert.equal(NO_TOKEN_COPY.message, "Open the link Kopi Boy sent you on WhatsApp again.");
  });

  it("formats prices in dollars", () => {
    assert.equal(formatPrice(4.5), "S$4.50");
  });
});

describe("claim button", () => {
  it("stays off until the owner ticks \"I have read\" (scrolling to the end is not enough)", () => {
    assert.equal(canClaimShop({ ticked: false, busy: false }), false);
    assert.equal(canClaimShop({ ticked: true, busy: false }), true);
  });

  it("stays off while a claim is being sent, even when ticked", () => {
    assert.equal(canClaimShop({ ticked: true, busy: true }), false);
    assert.equal(canClaimShop({ ticked: false, busy: true }), false);
  });
});

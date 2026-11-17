import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { copyText } from "./copy-link.ts";

describe("copyText (in-app browser 'Copy link')", () => {
  it("uses the clipboard API when there is one", async () => {
    let copied = "";
    let legacyUsed = false;
    const ok = await copyText("https://example.test/", {
      clipboard: { writeText: async (t) => void (copied = t) },
      legacyCopy: () => (legacyUsed = true),
    });
    assert.equal(ok, true);
    assert.equal(copied, "https://example.test/");
    assert.equal(legacyUsed, false);
  });

  it("falls back when the in-app browser has no clipboard API", async () => {
    let copied = "";
    const ok = await copyText("https://example.test/", { clipboard: undefined, legacyCopy: (t) => ((copied = t), true) });
    assert.equal(ok, true);
    assert.equal(copied, "https://example.test/");
  });

  it("falls back when the clipboard API refuses", async () => {
    const ok = await copyText("x", { clipboard: { writeText: () => Promise.reject(new Error("NotAllowed")) }, legacyCopy: () => true });
    assert.equal(ok, true);
  });

  it("reports failure instead of throwing when nothing works", async () => {
    assert.equal(await copyText("x", { clipboard: null, legacyCopy: () => false }), false);
    assert.equal(
      await copyText("x", {
        clipboard: { writeText: () => { throw new Error("boom"); } },
        legacyCopy: () => { throw new Error("boom"); },
      }),
      false
    );
    assert.equal(await copyText("x", {}), false);
  });
});

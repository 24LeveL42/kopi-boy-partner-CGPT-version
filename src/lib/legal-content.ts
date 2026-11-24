import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Kopi Boy's Terms of Use and Privacy Policy, word for word. Copied from the
 * Customer repo (src/content/legal) into src/content/legal here, so the claim
 * page shows them inline rather than linking out. When the Customer copies
 * change, copy them again and bump PRIVACY_POLICY_VERSION.
 *
 * Read only while /claim is prerendered at build time (the page is
 * force-static), so the text is baked into its HTML. next.config.ts also
 * traces src/content/legal into the /claim function, in case the page is
 * ever rendered at request time.
 */
export type LegalDoc = "terms" | "privacy";

export function readLegalDoc(doc: LegalDoc): string {
  return readFileSync(path.join(process.cwd(), "src", "content", "legal", `${doc}.md`), "utf8");
}

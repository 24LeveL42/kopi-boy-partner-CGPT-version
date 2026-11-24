import type { Metadata } from "next";
import { ClaimFlow } from "@/components/ClaimFlow";
import { LegalText } from "@/components/LegalText";
import { readLegalDoc } from "@/lib/legal-content";

/**
 * https://partners.kopi-boy.com/claim#<token> — the owner of a shop HQ set up
 * claims it. The token is only in the # fragment (never sent to a server by
 * the browser); ClaimFlow reads it, clears it from the address bar and posts it.
 *
 * Static: the Terms and Privacy text is read from src/content/legal at build
 * time and baked into the page.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Claim your shop · Kopi Boy Partner",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ClaimPage() {
  return (
    <ClaimFlow
      terms={<LegalText id="claim-terms" source={readLegalDoc("terms")} />}
      privacy={<LegalText id="claim-privacy" source={readLegalDoc("privacy")} />}
    />
  );
}

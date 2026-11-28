import type { Metadata } from "next";
import { ResumeFlow } from "@/components/ResumeFlow";

/**
 * https://partners.kopi-boy.com/resume#<token> — HQ's one-time sign-in link
 * for an owner whose shop is already claimed. The token is only in the #
 * fragment (never sent to a server by the browser); ResumeFlow reads it,
 * clears it from the address bar and posts it to /api/claim/resume only when
 * the owner taps "Sign me in".
 *
 * Static. Referrer-Policy: no-referrer is sent as a header too
 * (next.config.ts), not only as this meta tag.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Sign in to your shop · Kopi Boy Partner",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ResumePage() {
  return <ResumeFlow />;
}

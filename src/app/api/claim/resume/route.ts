import { handleSigninRequest } from "@/lib/assisted-signin";
import { claimRouteDeps, notConfigured } from "@/lib/claim-route";

/**
 * POST { token } → signs an assisted owner back in to their existing account
 * (HQ's sign-in link). POST only: no other method is exported, so the token
 * never travels in a URL. See signInAssistedOwner in src/lib/assisted-signin.ts.
 */
export async function POST(request: Request) {
  const ctx = await claimRouteDeps();
  if (!ctx) return notConfigured();
  return handleSigninRequest(request, ctx.deps, ctx.secret);
}

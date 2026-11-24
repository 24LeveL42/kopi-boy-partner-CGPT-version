import { handleCompleteRequest } from "@/lib/assisted-claim";
import { claimRouteDeps, notConfigured } from "@/lib/claim-route";

/** POST { token } → signs the owner in and claims the shop. See completeClaim in src/lib/assisted-claim.ts. */
export async function POST(request: Request) {
  const ctx = await claimRouteDeps();
  if (!ctx) return notConfigured();
  return handleCompleteRequest(request, ctx.deps, ctx.secret);
}

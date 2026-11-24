import { handlePreviewRequest } from "@/lib/assisted-claim";
import { claimRouteDeps, notConfigured } from "@/lib/claim-route";

/** POST { token } → the draft shop and menu, or why the link can't be used. See src/lib/assisted-claim.ts. */
export async function POST(request: Request) {
  const ctx = await claimRouteDeps();
  if (!ctx) return notConfigured();
  return handlePreviewRequest(request, ctx.deps, ctx.secret);
}

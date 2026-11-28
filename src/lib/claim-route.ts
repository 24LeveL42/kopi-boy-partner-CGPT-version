import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimSecret, type AdminClient, type ClaimDeps, type SessionClient } from "@/lib/assisted-claim";
import type { SigninAdminClient, SigninDeps, SigninSessionClient } from "@/lib/assisted-signin";

/**
 * The real dependencies for /api/claim/preview, /api/claim/complete and
 * /api/claim/resume: the service-role client, the cookie-writing server
 * client, and a cookie wipe. null (→ 503) when an env var is missing.
 */
export async function claimRouteDeps(): Promise<{ deps: ClaimDeps & SigninDeps; secret: string } | null> {
  const secret = claimSecret(process.env);
  const admin = createAdminClient();
  if (!secret || !admin) {
    // Env vars: ASSISTED_CLAIM_IP_HMAC_SECRET (32+ chars) and the service-role key (see src/lib/supabase/admin.ts).
    console.error(`claim: not configured (${secret ? "service-role key" : "ASSISTED_CLAIM_IP_HMAC_SECRET"} missing)`);
    return null;
  }
  const session = await createClient();
  const cookieStore = await cookies();
  return {
    secret,
    deps: {
      admin: admin as unknown as AdminClient & SigninAdminClient,
      session: session as unknown as SessionClient & SigninSessionClient,
      clearAuthCookies: () => {
        for (const { name } of cookieStore.getAll()) {
          if (name.startsWith("sb-")) cookieStore.delete(name);
        }
      },
    },
  };
}

export function notConfigured(): Response {
  return Response.json({ status: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
}

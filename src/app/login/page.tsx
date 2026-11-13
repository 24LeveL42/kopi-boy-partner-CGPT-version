import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "@/components/LoginForm";
import { RetryScreen } from "@/components/RetryScreen";
import { loadUser } from "@/lib/partner-state";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { LOAD_ERROR_COPY } from "@/lib/onboarding-copy";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { error, next: rawNext } = await searchParams;
  // Where to go after signing in (e.g. /welcome from the approval email).
  // User-supplied: only a same-site relative path, else "/".
  const next = safeRedirectPath(rawNext, "/");

  const supabase = await createClient();
  const auth = await loadUser(supabase);
  if (!auth.ok) return <RetryScreen title={LOAD_ERROR_COPY.title} message={LOAD_ERROR_COPY.message} />;

  // Already signed in — nothing to do here; go straight on.
  if (auth.user) redirect(next);

  // /auth/callback sends failed Google sign-ins here with ?error=auth-failed.
  const initialError =
    error === "auth-failed" ? "Sign-in didn't complete. Please try again." : null;

  return <LoginForm initialError={initialError} next={next} />;
}

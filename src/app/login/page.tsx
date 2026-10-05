import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "@/components/LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Already signed in — nothing to do here; "/" routes them to the right screen.
  if (user) redirect("/");

  // /auth/callback sends failed Google sign-ins here with ?error=auth-failed.
  const { error } = await searchParams;
  const initialError =
    error === "auth-failed" ? "Sign-in didn't complete. Please try again." : null;

  return <LoginForm initialError={initialError} />;
}

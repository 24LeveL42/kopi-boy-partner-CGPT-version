import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";
import { PartnerProfileForm } from "@/components/PartnerProfileForm";
import { resolvePartnerScreen } from "@/lib/partner-routing";
import type { Profile, CookApplication, RiderApplication, PickerApplication } from "@/lib/types-auth";

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed out — "/" shows the Sign in / Sign up screen.
  if (!user) redirect("/");

  const latestApplication = <T,>(table: string) =>
    supabase.from(table).select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle<T>();

  const [{ data: profile }, { data: cookApp }, { data: riderApp }, { data: pickerApp }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single<Profile>(),
    latestApplication<CookApplication>("cook_applications"),
    latestApplication<RiderApplication>("rider_applications"),
    latestApplication<PickerApplication>("picker_applications"),
  ]);

  // Same decision the home screen makes, so "approved rider/picker" means the
  // same thing here as it does for their dashboards. The kitchen only matters
  // to the cook branch, which this page doesn't care about.
  const screen = resolvePartnerScreen({ profile, cookApp, riderApp, pickerApp, kitchen: null });
  const profileRole =
    screen.kind === "partner-shell" && screen.view === "rider" ? "rider" : screen.kind === "picker-shell" ? "picker" : null;

  return (
    <div className="min-h-page px-4 py-8 sm:px-6" style={{ background: "var(--kb-navy)", color: "var(--kb-on-navy)" }}>
      <div className="mx-auto max-w-sm space-y-4">
        <h1 className="font-display text-xl font-bold">Account</h1>
        {profileRole && profile && (
          <PartnerProfileForm
            role={profileRole}
            userId={user.id}
            fullName={profile.full_name}
            phone={profile.phone}
            photoUrl={profile.photo_url}
          />
        )}
        <div className="rounded-2xl bg-white p-5 shadow-lg" style={{ color: "var(--kb-ink)" }}>
          <p className="text-sm" style={{ color: "var(--kb-ink-soft)" }}>Signed in as</p>
          <p className="mt-1 font-semibold">{user.email ?? user.phone}</p>
          {profile && (
            <p className="mt-1 text-sm capitalize" style={{ color: "var(--kb-ink-soft)" }}>
              Role: {profile.role}
            </p>
          )}
          <div className="mt-5">
            <SignOutButton />
          </div>
        </div>
      </div>
    </div>
  );
}

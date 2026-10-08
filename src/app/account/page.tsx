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
    <div className="kb-page min-h-page px-4 py-8 sm:px-6">
      <div className="relative mx-auto max-w-md space-y-4">
        <div className="mb-2">
          <p className="kb-eyebrow">Kopi Boy · Partner</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight" style={{ color: "var(--kb-ink)" }}>
            Account
          </h1>
        </div>
        {profileRole && profile && (
          <PartnerProfileForm
            role={profileRole}
            userId={user.id}
            fullName={profile.full_name}
            phone={profile.phone}
            photoUrl={profile.photo_url}
          />
        )}
        <div className="kb-card p-5">
          <p className="kb-eyebrow">Signed in as</p>
          <p className="mt-1.5 break-all text-[15px] font-bold">{user.email ?? user.phone}</p>
          {profile && (
            <span
              className="mt-3 inline-flex rounded-full px-3 py-1 text-xs font-bold capitalize"
              style={{ background: "var(--kb-mint)", color: "var(--kb-green-deep)" }}
            >
              Role: {profile.role}
            </span>
          )}
          <div className="mt-5">
            <SignOutButton />
          </div>
        </div>
      </div>
    </div>
  );
}

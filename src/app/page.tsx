import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "@/components/LoginForm";
import { ApplyForm } from "@/components/ApplyForm";
import { StatusScreen } from "@/components/StatusScreen";
import { PartnerShell } from "@/components/PartnerShell";
import { KitchenSetupGate } from "@/components/KitchenSetupGate";
import { PickerShell } from "@/components/PickerShell";
import { resolvePartnerScreen } from "@/lib/partner-routing";
import type { Profile, CookApplication, RiderApplication, PickerApplication } from "@/lib/types-auth";
import type { Kitchen } from "@/lib/types-kitchen";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <LoginForm />;
  }

  const [{ data: profile }, { data: cookApp }, { data: riderApp }, { data: pickerApp }, { data: kitchen }] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single<Profile>(),
      supabase
        .from("cook_applications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<CookApplication>(),
      supabase
        .from("rider_applications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<RiderApplication>(),
      supabase
        .from("picker_applications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<PickerApplication>(),
      supabase.from("kitchens").select("*").eq("id", user.id).maybeSingle<Kitchen>(),
    ]);

  // All routing decisions live in resolvePartnerScreen (unit-checkable, no DB).
  const screen = resolvePartnerScreen({ profile, cookApp, riderApp, pickerApp, kitchen });

  switch (screen.kind) {
    case "blocked":
      return (
        <StatusScreen
          tone="danger"
          signOut
          title="Account temporarily blocked"
          message="Your partner account has been temporarily blocked. Contact Kopi Boy support for details."
        />
      );
    case "application-pending":
      return (
        <StatusScreen
          tone="warning"
          signOut
          title="Application under review"
          message="Thanks for applying! Kopi Boy HQ is reviewing your application — we'll let you know once it's approved."
        />
      );
    case "application-rejected":
      return (
        <StatusScreen
          tone="danger"
          signOut
          title="Application not approved"
          message="Your application wasn't approved this time. Contact Kopi Boy support if you'd like to know more or reapply."
        />
      );
    case "kitchen-setup":
      return <KitchenSetupGate userId={user.id} defaults={screen.defaults} />;
    case "partner-shell":
      return (
        <PartnerShell
          userId={user.id}
          defaultView={screen.view}
          riderProfile={
            screen.view === "rider" && profile
              ? { fullName: profile.full_name, phone: profile.phone, photoUrl: profile.photo_url }
              : undefined
          }
        />
      );
    case "picker-shell":
      return (
        <PickerShell
          userId={user.id}
          profile={profile ? { fullName: profile.full_name, phone: profile.phone, photoUrl: profile.photo_url } : undefined}
        />
      );
    case "apply":
      return <ApplyForm userId={user.id} />;
  }
}

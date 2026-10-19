import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "@/components/LoginForm";
import { ApplyForm } from "@/components/ApplyForm";
import { StatusScreen } from "@/components/StatusScreen";
import { PartnerShell } from "@/components/PartnerShell";
import { KitchenSetupGate } from "@/components/KitchenSetupGate";
import { AdminMessagePanel } from "@/components/AdminMessagePanel";
import { BLOCKED_SCREEN_COPY } from "@/lib/admin-messages";
import { resolvePartnerScreen } from "@/lib/partner-routing";
import type { Profile, CookApplication, RiderApplication } from "@/lib/types-auth";
import type { Kitchen } from "@/lib/types-kitchen";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <LoginForm />;
  }

  const [{ data: profile }, { data: cookApp }, { data: riderApp }, { data: kitchen }] =
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
      supabase.from("kitchens").select("*").eq("id", user.id).maybeSingle<Kitchen>(),
    ]);

  // All routing decisions live in resolvePartnerScreen (unit-checkable, no DB).
  const screen = resolvePartnerScreen({ profile, cookApp, riderApp, kitchen });

  switch (screen.kind) {
    case "blocked":
      // Replaces the whole cook / rider area. No block reason is
      // stored, so none is shown — the partner asks HQ through the box below.
      return (
        <StatusScreen tone="warning" signOut title={BLOCKED_SCREEN_COPY.title} message={BLOCKED_SCREEN_COPY.body}>
          <AdminMessagePanel userId={user.id} />
        </StatusScreen>
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
          partnerName={profile?.full_name ?? null}
          businessName={screen.view === "cook" ? kitchen?.business_name ?? null : null}
          riderProfile={
            screen.view === "rider"
              ? { fullName: profile?.full_name ?? null, phone: profile?.phone ?? null, photoUrl: profile?.photo_url ?? null }
              : undefined
          }
        />
      );
    case "apply":
      return <ApplyForm userId={user.id} />;
  }
}

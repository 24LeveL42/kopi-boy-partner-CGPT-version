import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NotificationsCenter } from "@/components/NotificationsCenter";
import { TopBar } from "@/components/TopBar";

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed out — "/" shows the Sign in / Sign up screen.
  if (!user) redirect("/");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

  return (
    <div className="kb-page min-h-page">
      <div className="relative mx-auto max-w-md px-4 pb-10 pt-3 sm:max-w-lg sm:px-6">
        <TopBar badge={profile?.role === "picker" ? "Picker" : "Partner"} />
        <div className="mb-5 mt-5">
          <p className="kb-eyebrow">Kopi Boy · Partner</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight" style={{ color: "var(--kb-ink)" }}>
            Notifications
          </h1>
        </div>
        <NotificationsCenter role={profile?.role ?? "customer"} />
      </div>
    </div>
  );
}

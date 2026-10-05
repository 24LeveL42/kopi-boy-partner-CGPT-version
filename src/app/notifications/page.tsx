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
    <div className="mx-auto min-h-page max-w-md px-5 py-6 sm:max-w-lg" style={{ background: "var(--kb-navy)" }}>
      <TopBar badge={profile?.role === "picker" ? "Picker" : "Partner"} />
      <h1 className="mt-4 mb-4 font-display text-lg font-bold" style={{ color: "var(--kb-on-navy)" }}>
        Notifications
      </h1>
      <NotificationsCenter role={profile?.role ?? "customer"} />
    </div>
  );
}

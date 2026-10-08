import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RequestPickerForm } from "@/components/RequestPickerForm";
import { TopBar } from "@/components/TopBar";
import { LiveRefresh } from "@/components/LiveRefresh";
import type { Profile } from "@/lib/types-auth";
import type { PickupRequestWithKitchen } from "@/lib/types-picker";
import { publicKitchenArea } from "@/lib/kitchen-profile";

interface RawRow {
  id: string;
  rider_id: string;
  kitchen_id: string;
  picker_id: string | null;
  status: string;
  suggested_fee: number;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  kitchens: { business_name: string; postal_sector: string | null } | null;
}

export default async function RequestPickerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile || profile.role !== "rider") redirect("/");

  const [{ data: kitchens }, { data: requests }] = await Promise.all([
    supabase.from("kitchens").select("id, business_name, postal_sector").eq("is_live", true),
    supabase
      .from("pickup_requests")
      .select("*, kitchens(business_name, postal_sector)")
      .eq("rider_id", user.id)
      .order("created_at", { ascending: false })
      .returns<RawRow[]>(),
  ]);

  const myRequests: PickupRequestWithKitchen[] = (requests ?? []).map((r) => ({
    id: r.id,
    rider_id: r.rider_id,
    kitchen_id: r.kitchen_id,
    picker_id: r.picker_id,
    status: r.status as PickupRequestWithKitchen["status"],
    suggested_fee: r.suggested_fee,
    created_at: r.created_at,
    accepted_at: r.accepted_at,
    completed_at: r.completed_at,
    kitchen_business_name: r.kitchens?.business_name ?? "Unknown kitchen",
    kitchen_address: publicKitchenArea(r.kitchens?.postal_sector),
    kitchen_maps_url: null,
  }));

  return (
    <div className="kb-page min-h-page">
      <div className="relative mx-auto max-w-md px-4 pb-10 pt-3 sm:px-6">
        <TopBar />
        <LiveRefresh sources={[{ table: "pickup_requests", filter: `rider_id=eq.${user.id}` }]} />
        <div className="mt-5">
          <p className="kb-eyebrow">On the road</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight" style={{ color: "var(--kb-ink)" }}>
            Request a picker
          </h1>
          <p className="mt-1 text-sm leading-6" style={{ color: "var(--kb-ink-soft)" }}>
            Optional — a picker collects from the cook and hands the order to you nearby.
          </p>
        </div>

        {!kitchens || kitchens.length === 0 ? (
          <p className="kb-card mt-5 p-5 text-center text-sm" style={{ color: "var(--kb-ink-soft)" }}>
            No live kitchens to pick up from yet.
          </p>
        ) : (
          <div className="mt-5">
            <RequestPickerForm userId={user.id} kitchens={kitchens} myRequests={myRequests} />
          </div>
        )}
      </div>
    </div>
  );
}

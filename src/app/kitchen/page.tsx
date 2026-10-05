import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { KitchenSetupForm } from "@/components/KitchenSetupForm";
import type { Profile } from "@/lib/types-auth";
import type { Kitchen, MenuItem } from "@/lib/types-kitchen";
import type { KitchenLocation } from "@/lib/kitchen-profile";

export default async function KitchenPage() {
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

  if (!profile || profile.role !== "cook") redirect("/");

  const [{ data: kitchen }, { data: address }, { data: items }] = await Promise.all([
    supabase.from("kitchens").select("*").eq("id", user.id).maybeSingle<Kitchen>(),
    supabase
      .from("kitchen_addresses")
      .select("business_address, postal_code, latitude, longitude")
      .eq("kitchen_id", user.id)
      .maybeSingle<KitchenLocation>(),
    supabase
      .from("menu_items")
      .select("*")
      .eq("kitchen_id", user.id)
      .order("created_at", { ascending: true })
      .returns<MenuItem[]>(),
  ]);

  return (
    <KitchenSetupForm
      userId={user.id}
      defaults={{
        business_name: kitchen?.business_name ?? "",
        category: kitchen?.category ?? "home-cook",
        business_address: address?.business_address ?? "",
        postal_code: address?.postal_code ?? "",
        latitude: address?.latitude ?? null,
        longitude: address?.longitude ?? null,
        description: kitchen?.description ?? "",
      }}
      existingKitchen={kitchen}
      existingItems={items ?? []}
    />
  );
}

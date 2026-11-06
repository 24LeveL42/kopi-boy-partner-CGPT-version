import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { KitchenSetupForm } from "@/components/KitchenSetupForm";
import { StatusScreen } from "@/components/StatusScreen";
import type { Profile } from "@/lib/types-auth";
import type { Kitchen, MenuItem } from "@/lib/types-kitchen";
import type { KitchenLocation } from "@/lib/kitchen-profile";
import { addonsByItem, type GroupRow, type SavedGroup } from "@/lib/menu-addons";
import { KITCHEN_COLUMNS, loadMyKitchenPrivate } from "@/lib/kitchen-private";
import { loadKitchenRegion } from "@/lib/ride-regions";

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

  // Blocked cooks get the blocked screen on "/" instead of their kitchen.
  if (!profile || profile.role !== "cook" || !profile.is_active) redirect("/");

  // Public columns explicitly (never "*"), PayNow + terms date through
  // get_my_kitchen_private() — kitchen privacy Phase 2.
  // kitchens.region is a read of its own (loadKitchenRegion): if it fails,
  // only the "Your region" line goes, never the page.
  const [{ data: kitchen, error: kitchenError }, privateLoad, { data: address }, { data: items }, region] = await Promise.all([
    supabase.from("kitchens").select(KITCHEN_COLUMNS).eq("id", user.id).maybeSingle<Kitchen>(),
    loadMyKitchenPrivate(supabase, user.id),
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
    loadKitchenRegion(supabase, user.id),
  ]);

  // Not "no kitchen": the form would then save a new one over whatever exists.
  if (kitchenError) {
    console.error("Kitchen page: couldn't load the kitchen", kitchenError);
    return (
      <StatusScreen
        tone="warning"
        title="Couldn't load your kitchen"
        message="Something went wrong loading your kitchen. Please refresh the page in a moment."
      />
    );
  }

  // Add-ons for the dishes, by dish id. null = they couldn't be read, and
  // then the form doesn't offer them at all: saving add-ons replaces a dish's
  // whole list, so it must never save from a list that didn't load.
  let addons: Record<string, SavedGroup[]> | null = {};
  const itemIds = (items ?? []).map((i) => i.id);
  if (itemIds.length > 0) {
    const { data: groups, error: addonsError } = await supabase
      .from("menu_option_groups")
      .select("id, menu_item_id, name, required, max_picks, sort_order, menu_options(id, name, price, sold_out, sort_order)")
      .in("menu_item_id", itemIds)
      .returns<GroupRow[]>();
    if (addonsError) console.error("Kitchen page: couldn't load add-ons", addonsError);
    addons = addonsError ? null : addonsByItem(groups ?? []);
  }

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
      existingPrivate={privateLoad.ok ? privateLoad.data : null}
      privateLoadFailed={!privateLoad.ok}
      existingItems={items ?? []}
      existingAddons={addons}
      region={region}
    />
  );
}

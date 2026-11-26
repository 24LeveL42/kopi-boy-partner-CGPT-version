import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { KitchenSetupForm } from "@/components/KitchenSetupForm";
import { RetryScreen } from "@/components/RetryScreen";
import type { Profile } from "@/lib/types-auth";
import type { Kitchen, MenuItem } from "@/lib/types-kitchen";
import type { KitchenLocation } from "@/lib/kitchen-profile";
import { addonsByItem, type GroupRow, type SavedGroup } from "@/lib/menu-addons";
import { KITCHEN_COLUMNS, loadMyKitchenPrivate, type KitchenPrivateLoad } from "@/lib/kitchen-private";
import { loadKitchenRegion } from "@/lib/ride-regions";
import { loadUser } from "@/lib/partner-state";
import { retryOnce, withTimeout } from "@/lib/load-timeout";
import { KITCHEN_LOAD_ERROR_COPY, LOAD_ERROR_COPY } from "@/lib/onboarding-copy";
import { kitchenUenState, loadApprovedBusinessType } from "@/lib/kitchen-uen";

interface KitchenPageData {
  profile: Profile | null;
  /** The profile or kitchen couldn't be read (not "there isn't one"). */
  failed: boolean;
  kitchen: Kitchen | null;
  privateLoad: KitchenPrivateLoad;
  address: KitchenLocation | null;
  items: MenuItem[];
  /** Add-ons by dish id; null = they couldn't be read (see below). */
  addons: Record<string, SavedGroup[]> | null;
  /** The latest approved cook application (same rule as the database); decides whether a UEN is needed. */
  approvedApp: { business_type: string | null } | null;
}

/** One attempt at everything the page needs; the caller adds the time limit and retry. */
async function readKitchenPage(supabase: SupabaseClient, userId: string, signal: AbortSignal): Promise<KitchenPageData> {
  // Public columns explicitly (never "*"), PayNow + terms date through
  // get_my_kitchen_private() — kitchen privacy Phase 2.
  // kitchens.region is a read of its own (loadKitchenRegion): if it fails,
  // only the "Your region" line goes, never the page.
  const [profileRead, kitchenRead, privateLoad, { data: address }, { data: items }, approved] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).abortSignal(signal).single<Profile>(),
    supabase.from("kitchens").select(KITCHEN_COLUMNS).eq("id", userId).abortSignal(signal).maybeSingle<Kitchen>(),
    loadMyKitchenPrivate(supabase, userId),
    supabase
      .from("kitchen_addresses")
      .select("business_address, postal_code, latitude, longitude")
      .eq("kitchen_id", userId)
      .abortSignal(signal)
      .maybeSingle<KitchenLocation>(),
    supabase
      .from("menu_items")
      .select("*")
      .eq("kitchen_id", userId)
      // HQ-hidden dishes are never shown to the cook, so the form can't save over or delete them.
      .eq("is_hidden", false)
      .order("created_at", { ascending: true })
      .abortSignal(signal)
      .returns<MenuItem[]>(),
    // Never guessed: a failed read retries, then shows "Try again", so a shop
    // that needs a UEN is never sent is_live: true without one.
    loadApprovedBusinessType(supabase, userId, signal),
  ]);

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
      .abortSignal(signal)
      .returns<GroupRow[]>();
    if (addonsError) console.error("Kitchen page: couldn't load add-ons", addonsError);
    addons = addonsError ? null : addonsByItem(groups ?? []);
  }

  const profileFailed = !!profileRead.error && profileRead.error.code !== "PGRST116";
  if (kitchenRead.error) console.error("Kitchen page: couldn't load the kitchen", kitchenRead.error);
  return {
    profile: profileRead.data,
    failed: profileFailed || !!kitchenRead.error || !approved.ok,
    kitchen: kitchenRead.data,
    privateLoad,
    address: address ?? null,
    items: items ?? [],
    addons,
    approvedApp: approved.ok ? approved.approvedApp : null,
  };
}

export default async function KitchenPage() {
  const supabase = await createClient();
  const auth = await loadUser(supabase);
  if (!auth.ok) return <RetryScreen title={LOAD_ERROR_COPY.title} message={LOAD_ERROR_COPY.message} />;
  const user = auth.user;
  if (!user) redirect("/");

  // A time limit and one automatic retry, then "Try again" — never a
  // skeleton that doesn't stop. The region line is separate and optional.
  const [page, region] = await Promise.all([
    retryOnce(() => withTimeout((signal) => readKitchenPage(supabase, user.id, signal)), (r) => r.failed).catch((e) => {
      console.error("Kitchen page: load timed out", e);
      return null;
    }),
    withTimeout(() => loadKitchenRegion(supabase, user.id)).catch(() => null),
  ]);

  // Blocked cooks get the blocked screen on "/" instead of their kitchen;
  // anyone who isn't a cook gets the screen "/" has for them.
  const profile = page?.profile;
  if (page && (!profile ? !page.failed : profile.role !== "cook" || !profile.is_active)) redirect("/");

  // Not "no kitchen": the form would then save a new one over whatever exists.
  if (!page || page.failed) {
    return <RetryScreen signOut title={KITCHEN_LOAD_ERROR_COPY.title} message={KITCHEN_LOAD_ERROR_COPY.message} />;
  }
  const { kitchen, privateLoad, address, items, addons, approvedApp } = page;

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
      existingItems={items}
      existingAddons={addons}
      region={region}
      uenState={kitchen ? kitchenUenState({ approvedApp, kitchenUen: kitchen.business_uen, isLive: kitchen.is_live }) : { kind: "not-needed" }}
    />
  );
}

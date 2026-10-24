import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_DEAL_SETTINGS, type DealMenuItem, type DealSettings, type Promotion, type PromotionWithUsage } from "./promotions.ts";

/**
 * Reads for the Promotions & Deals pages, run on the server with the cook's
 * own session, so the promotions read policies decide what comes back.
 */

type PromotionRow = Promotion & { promotion_items: { menu_item_id: string }[] | null };

/** Signed-in, active cook with a kitchen; null sends the page back to "/". */
export async function loadDealCook(supabase: SupabaseClient): Promise<{ userId: string } | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const [{ data: profile }, { data: kitchen }] = await Promise.all([
    supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle<{ role: string; is_active: boolean }>(),
    supabase.from("kitchens").select("id").eq("id", user.id).maybeSingle<{ id: string }>(),
  ]);
  if (!profile || profile.role !== "cook" || !profile.is_active || !kitchen) return null;
  return { userId: user.id };
}

export interface DealContext {
  menu: DealMenuItem[];
  settings: DealSettings;
  /** Set when HQ has banned this kitchen from running deals. */
  ban: { reason: string | null } | null;
  /** When this was read: the pages' first "now", so server and browser render the same times. */
  loadedAt: number;
}

export async function loadDealContext(supabase: SupabaseClient, userId: string): Promise<DealContext> {
  const [{ data: menu }, { data: settings, error: settingsError }, { data: ban }] = await Promise.all([
    supabase.from("menu_items").select("id, name, price").eq("kitchen_id", userId).order("created_at", { ascending: true }).returns<DealMenuItem[]>(),
    supabase
      .from("app_settings")
      .select("deals_enabled, max_percent_off, max_deal_days")
      .maybeSingle<{ deals_enabled: boolean; max_percent_off: number; max_deal_days: number }>(),
    supabase.from("kitchen_deal_bans").select("reason").eq("kitchen_id", userId).maybeSingle<{ reason: string | null }>(),
  ]);
  if (settingsError) console.error("Promotions: couldn't read app_settings", settingsError);
  return {
    menu: (menu ?? []).map((m) => ({ ...m, price: Number(m.price) })),
    settings: settings
      ? { dealsEnabled: settings.deals_enabled, maxPercentOff: Number(settings.max_percent_off), maxDealDays: Number(settings.max_deal_days) }
      : DEFAULT_DEAL_SETTINGS,
    ban: ban ?? null,
    loadedAt: Date.now(),
  };
}

function normalise(row: PromotionRow, orderCount: number): PromotionWithUsage {
  const { promotion_items, ...p } = row;
  const num = (v: number | null) => (v == null ? null : Number(v));
  return {
    ...p,
    percent_off: num(p.percent_off),
    amount_off: num(p.amount_off),
    min_spend: num(p.min_spend),
    deal_price: num(p.deal_price),
    quantity_claimed: Number(p.quantity_claimed ?? 0),
    item_ids: (promotion_items ?? []).map((pi) => pi.menu_item_id),
    order_count: orderCount,
  };
}

/** Every order that used the deal, whatever its status: those orders keep pointing at it. */
async function countOrders(supabase: SupabaseClient, userId: string, promotionId: string): Promise<number> {
  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("kitchen_id", userId)
    .eq("promotion_id", promotionId);
  if (error) {
    console.error("Promotions: couldn't count orders", error);
    return 0;
  }
  return count ?? 0;
}

export async function loadPromotions(supabase: SupabaseClient, userId: string): Promise<{ promotions: PromotionWithUsage[]; error: string | null }> {
  const { data, error } = await supabase
    .from("promotions")
    .select("*, promotion_items(menu_item_id)")
    .eq("kitchen_id", userId)
    .order("starts_at", { ascending: false })
    .returns<PromotionRow[]>();
  if (error) {
    console.error("Promotions: couldn't load deals", error);
    return { promotions: [], error: "Your deals couldn't be loaded. Please try again." };
  }
  const rows = data ?? [];
  const counts = await Promise.all(rows.map((row) => countOrders(supabase, userId, row.id)));
  return { promotions: rows.map((row, i) => normalise(row, counts[i])), error: null };
}

export async function loadPromotion(supabase: SupabaseClient, userId: string, id: string): Promise<PromotionWithUsage | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await supabase
    .from("promotions")
    .select("*, promotion_items(menu_item_id)")
    .eq("kitchen_id", userId)
    .eq("id", id)
    .maybeSingle<PromotionRow>();
  if (error) console.error("Promotions: couldn't load deal", error);
  if (!data) return null;
  return normalise(data, await countOrders(supabase, userId, id));
}

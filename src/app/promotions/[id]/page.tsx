import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PromotionForm } from "@/components/PromotionForm";
import { PromotionsFrame, PromotionsNotice } from "@/components/PromotionsFrame";
import { loadDealContext, loadDealCook, loadHiddenDealDishes, loadPromotion } from "@/lib/promotions-data";
import { canEdit, hiddenDealItemIds } from "@/lib/promotions";

export default async function EditPromotionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const cook = await loadDealCook(supabase);
  if (!cook) redirect("/");

  const [promotion, { menu, settings, ban, loadedAt }] = await Promise.all([
    loadPromotion(supabase, cook.userId, id),
    loadDealContext(supabase, cook.userId),
  ]);
  if (!promotion) notFound();

  // Dishes in this deal that HQ has hidden (not in `menu`): their names, so the form can list them to untick.
  const visibleIds = new Set(menu.map((m) => m.id));
  const hiddenIds = hiddenDealItemIds(promotion, menu);
  if (promotion.free_item_id && !visibleIds.has(promotion.free_item_id)) hiddenIds.push(promotion.free_item_id);
  const hiddenDishes = await loadHiddenDealDishes(supabase, cook.userId, hiddenIds);

  const back = <Link href="/promotions" className="font-semibold underline">Back to your deals</Link>;

  return (
    <PromotionsFrame title="Edit deal" intro={promotion.title}>
      {!canEdit(promotion) ? (
        <PromotionsNotice tone="danger">
          Kopi Boy HQ turned this deal off{promotion.disabled_reason ? `: ${promotion.disabled_reason}` : "."} It can&apos;t be changed. {back}
        </PromotionsNotice>
      ) : ban ? (
        <PromotionsNotice tone="danger">
          Kopi Boy HQ has paused deals for your kitchen{ban.reason ? `: ${ban.reason}` : "."} You can stop this deal from your list, but not change it. {back}
        </PromotionsNotice>
      ) : (
        <PromotionForm menu={menu} hiddenDishes={hiddenDishes} settings={settings} existing={promotion} serverNow={loadedAt} />
      )}
    </PromotionsFrame>
  );
}

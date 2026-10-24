import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PromotionsFrame, PromotionsNotice } from "@/components/PromotionsFrame";
import { PromotionsList } from "@/components/PromotionsList";
import { loadDealContext, loadDealCook, loadPromotions } from "@/lib/promotions-data";

export default async function PromotionsPage() {
  const supabase = await createClient();
  // Only an active cook with a kitchen; everyone else gets "/", which shows
  // their own screen (blocked, setup, rider dashboard…).
  const cook = await loadDealCook(supabase);
  if (!cook) redirect("/");

  const [{ promotions, error }, { menu, settings, ban, loadedAt }] = await Promise.all([
    loadPromotions(supabase, cook.userId),
    loadDealContext(supabase, cook.userId),
  ]);

  return (
    <PromotionsFrame title="Your deals" intro="Create deals for your kitchen. Running deals show in the Customer app and apply at checkout.">
      <div className="space-y-4">
        {!settings.dealsEnabled && (
          <PromotionsNotice tone="warning">
            Deals are switched off by Kopi Boy at the moment, so customers don&apos;t see them yet. You can still set them up.
          </PromotionsNotice>
        )}
        {ban && (
          <PromotionsNotice tone="danger">
            Kopi Boy HQ has paused deals for your kitchen{ban.reason ? `: ${ban.reason}` : "."} You can stop deals, but not create or change them.
          </PromotionsNotice>
        )}
        {menu.length === 0 && !ban && <PromotionsNotice>Add dishes to your menu first. Deals are built from your menu items.</PromotionsNotice>}
        {error && <p className="kb-alert-error rounded-2xl px-4 py-3 text-sm">{error}</p>}
        <PromotionsList userId={cook.userId} promotions={promotions} menu={menu} serverNow={loadedAt} canCreate={!ban && menu.length > 0} />
      </div>
    </PromotionsFrame>
  );
}

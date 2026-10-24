import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PromotionForm } from "@/components/PromotionForm";
import { PromotionsFrame, PromotionsNotice } from "@/components/PromotionsFrame";
import { loadDealContext, loadDealCook } from "@/lib/promotions-data";

export default async function NewPromotionPage() {
  const supabase = await createClient();
  const cook = await loadDealCook(supabase);
  if (!cook) redirect("/");

  const { menu, settings, ban, loadedAt } = await loadDealContext(supabase, cook.userId);

  return (
    <PromotionsFrame title="New deal" intro="Pick a type, set the offer and choose when it runs. You'll see a preview before you save.">
      {ban ? (
        <PromotionsNotice tone="danger">
          Kopi Boy HQ has paused deals for your kitchen{ban.reason ? `: ${ban.reason}` : "."}{" "}
          <Link href="/promotions" className="font-semibold underline">Back to your deals</Link>
        </PromotionsNotice>
      ) : menu.length === 0 ? (
        <PromotionsNotice>
          Add dishes to your menu first. <Link href="/kitchen" className="font-semibold underline">Manage kitchen &amp; menu</Link>
        </PromotionsNotice>
      ) : (
        <PromotionForm menu={menu} settings={settings} serverNow={loadedAt} />
      )}
    </PromotionsFrame>
  );
}

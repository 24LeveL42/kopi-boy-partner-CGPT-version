/**
 * How KitchenSetupForm saves the menu: existing rows keep their ids (updated
 * in place), new rows are inserted, and only the rows the cook removed are
 * deleted.
 *
 * Ids have to survive a save: order_items.menu_item_id, customers' carts and
 * promotion_items all point at them. promotion_items.menu_item_id is
 * ON DELETE CASCADE and promotions.free_item_id is ON DELETE SET NULL, so
 * deleting a deal's last eligible item silently turns it into a whole-menu
 * deal, and deleting a free item leaves a free-item deal that does nothing.
 * dealsAffectedByRemoval spots both before the cook saves.
 */

export interface SavedMenuItem {
  id: string;
  name: string;
  price: number;
  photo_url: string | null;
}

/** A menu row from the form, already trimmed and parsed. `id` is set only for rows loaded from the database. */
export interface MenuItemDraft {
  id?: string;
  name: string;
  price: number;
  photo_url: string;
}

export interface MenuItemFields {
  name: string;
  price: number;
  photo_url: string | null;
}

export interface MenuSavePlan {
  updates: (MenuItemFields & { id: string })[];
  inserts: MenuItemFields[];
  deleteIds: string[];
}

export function planMenuSave(existing: SavedMenuItem[], drafts: MenuItemDraft[]): MenuSavePlan {
  const byId = new Map(existing.map((item) => [item.id, item]));
  const kept = new Set<string>();
  const plan: MenuSavePlan = { updates: [], inserts: [], deleteIds: [] };

  for (const draft of drafts) {
    const fields: MenuItemFields = { name: draft.name, price: draft.price, photo_url: draft.photo_url.trim() || null };
    const saved = draft.id ? byId.get(draft.id) : undefined;
    if (!saved || kept.has(saved.id)) {
      // New, or an id that isn't (or is no longer) in this kitchen's menu.
      plan.inserts.push(fields);
      continue;
    }
    kept.add(saved.id);
    const changed =
      saved.name !== fields.name || Number(saved.price) !== fields.price || (saved.photo_url ?? null) !== fields.photo_url;
    if (changed) plan.updates.push({ id: saved.id, ...fields });
  }

  for (const item of existing) {
    if (!kept.has(item.id)) plan.deleteIds.push(item.id);
  }
  return plan;
}

/** A running or upcoming deal, with the menu items it uses. */
export interface DealUsingMenu {
  id: string;
  title: string;
  free_item_id: string | null;
  item_ids: string[];
}

export interface AffectedDeal {
  id: string;
  title: string;
  /** The deal's eligible items that would be removed. */
  removedItemIds: string[];
  /** Every eligible item goes, so the deal would apply to the whole menu. */
  losesLastItem: boolean;
  losesFreeItem: boolean;
  /** The deal's free item, when it would be removed. */
  removedFreeItemId: string | null;
  /** losesLastItem or losesFreeItem: the cook must choose to stop the deal or keep the item. */
  critical: boolean;
}

export function dealsAffectedByRemoval(deals: DealUsingMenu[], deleteIds: string[]): AffectedDeal[] {
  const removing = new Set(deleteIds);
  const affected: AffectedDeal[] = [];
  for (const deal of deals) {
    const removedItemIds = deal.item_ids.filter((id) => removing.has(id));
    const losesFreeItem = deal.free_item_id != null && removing.has(deal.free_item_id);
    if (removedItemIds.length === 0 && !losesFreeItem) continue;
    const losesLastItem = deal.item_ids.length > 0 && removedItemIds.length === deal.item_ids.length;
    affected.push({
      id: deal.id,
      title: deal.title,
      removedItemIds,
      losesLastItem,
      losesFreeItem,
      removedFreeItemId: losesFreeItem ? deal.free_item_id : null,
      critical: losesLastItem || losesFreeItem,
    });
  }
  return affected;
}

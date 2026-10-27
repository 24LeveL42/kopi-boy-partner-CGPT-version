/**
 * One line of a cook's order card: "Laksa x2  (Hot, Extra egg)  S$17.00".
 *
 * order_items.price is the dish's unit price and options_price the per-unit
 * total of the add-ons the customer picked, so the line is
 * (price + options_price) * quantity. order_item_options is the snapshot of
 * those picks. Orders from before add-ons have neither, and show as before.
 */

export interface OrderLineFields {
  id?: string;
  name: string;
  price: number | string;
  quantity: number;
  options_price?: number | string | null;
  order_item_options?: { name: string; sort_order?: number | null }[] | null;
}

export interface OrderLine {
  /** "Laksa x2" */
  label: string;
  /** "Hot, Extra egg", or "" with no add-ons. */
  options: string;
  total: number;
}

function amount(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function orderLine(item: OrderLineFields): OrderLine {
  const options = [...(item.order_item_options ?? [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((o) => o.name)
    .join(", ");
  return {
    label: `${item.name} x${item.quantity}`,
    options,
    total: round2((amount(item.price) + amount(item.options_price)) * item.quantity),
  };
}

/**
 * The orders query embeds order_item_options; if the cook can't read it
 * (no grant: 42501) or PostgREST doesn't know the relationship (PGRST200),
 * the whole query fails, so the panel loads again without it.
 */
export function isOrderOptionsUnavailable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST200" || error.code === "42501" || (error.message ?? "").includes("order_item_options");
}

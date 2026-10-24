/**
 * The amounts on a cook's order card. The customer PayNows the food total
 * (after the kitchen's deal) plus the delivery fee, so that sum is what the
 * cook should look for in their bank app.
 *
 * food_total (= subtotal - discount_total) and discount_total come from the
 * Customer repo's promotions SQL; older rows, or a read that doesn't include
 * them, fall back to subtotal.
 */

export interface OrderAmountFields {
  subtotal: number | string;
  discount_total?: number | string | null;
  food_total?: number | string | null;
  delivery_fee_estimate?: number | string | null;
}

function finite(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What the customer pays for the food. */
export function orderFoodTotal(order: OrderAmountFields): number {
  return finite(order.food_total) ?? finite(order.subtotal) ?? 0;
}

/** The deal's discount; 0 when there's none. */
export function orderDiscount(order: OrderAmountFields): number {
  const n = finite(order.discount_total);
  return n != null && n > 0 ? n : 0;
}

export function orderDeliveryFee(order: OrderAmountFields): number {
  return finite(order.delivery_fee_estimate) ?? 0;
}

/** Food total + delivery fee: the full PayNow amount. */
export function orderTotal(order: OrderAmountFields): number {
  return round2(orderFoodTotal(order) + orderDeliveryFee(order));
}

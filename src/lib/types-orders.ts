/**
 * Order types — Feature #005 (orders/order_items) + #006 (cook accept/reject
 * + PayNow). Mirrors the `orders` / `order_items` tables in
 * `docs/supabase-schema.sql`.
 *
 * order_status, payment_status, and preparation_status are deliberately
 * separate fields per the locked business rule that order/payment/
 * preparation/delivery/incident are separate status fields, not one
 * combined enum — never collapse them back into a single status.
 */

export type OrderStatus = "placed" | "accepted" | "rejected" | "cancelled";
export type PaymentStatus = "unpaid" | "paid";
export type PreparationStatus = "not_started" | "preparing" | "ready";

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  customer_id: string;
  kitchen_id: string;
  order_status: OrderStatus;
  payment_status: PaymentStatus;
  preparation_status: PreparationStatus;
  subtotal: number;
  decided_at: string | null;
  paid_at: string | null;
  ready_at: string | null;
  created_at: string;
}

export interface OrderWithItems extends Order {
  order_items: OrderItem[];
}

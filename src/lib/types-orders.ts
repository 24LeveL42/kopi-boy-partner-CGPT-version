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

import type { OrderDeliveryDetails } from "./order-delivery";

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

// The delivery fields (delivery_type, scheduled_for, address snapshot,
// customer_postal_code) come from OrderDeliveryDetails, all optional because
// older orders don't have them.
export interface Order extends OrderDeliveryDetails {
  id: string;
  customer_id: string;
  kitchen_id: string;
  order_status: OrderStatus;
  payment_status: PaymentStatus;
  preparation_status: PreparationStatus;
  // Gross food total, before the kitchen's deal.
  subtotal: number;
  // Set by place_order when a deal applied (Customer repo
  // docs/supabase-promotions.sql); food_total = subtotal - discount_total is
  // what the customer pays for the food. Optional: older reads lack them.
  discount_total?: number | null;
  food_total?: number | null;
  promotion_id?: string | null;
  promotion_label?: string | null;
  // Rider fee quoted to the customer at checkout. The customer PayNows the
  // food total + this fee; the cook hands the fee to the rider at pickup.
  delivery_fee_estimate: number | null;
  decided_at: string | null;
  paid_at: string | null;
  ready_at: string | null;
  created_at: string;
  // PayNow screenshot the customer uploads (key in the private
  // "payment-proofs" bucket). The cook "rejects" a proof by stamping
  // payment_proof_rejected_at; a newer upload supersedes that rejection.
  payment_proof_path: string | null;
  payment_proof_uploaded_at: string | null;
  payment_proof_rejected_at: string | null;
}

export interface OrderWithItems extends Order {
  order_items: OrderItem[];
}

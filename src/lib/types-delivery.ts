/**
 * Delivery request types — Feature #008 (rider workflow). A cook requests a
 * rider once the order is paid (before or after cooking); any approved rider can
 * accept, then marks it delivered. Delivery fee is agreed directly between
 * cook and rider off-platform — there's no fee column.
 */

import type { OrderDeliveryDetails } from "./order-delivery";

export type DeliveryRequestStatus = "open" | "accepted" | "completed" | "cancelled" | "release_requested";

export interface DeliveryRequest {
  id: string;
  order_id: string;
  kitchen_id: string;
  rider_id: string | null;
  status: DeliveryRequestStatus;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  /**
   * Set when the rider taps "I've collected the food" (status stays
   * 'accepted'). Undefined if docs/supabase-delivery-pickup.sql hasn't run.
   */
  picked_up_at?: string | null;
}

// Joined shape used by the rider dashboard — pulls in the kitchen name/
// address so the feed doesn't need a second round trip per row.
export interface DeliveryRequestWithKitchen extends DeliveryRequest {
  kitchen_business_name: string;
  /** "Postal sector 31" — or the full address once the viewer is assigned to this request. */
  kitchen_address: string;
  /** Only set for the viewer's own accepted request. */
  kitchen_maps_url: string | null;
  /**
   * Drop-off details from get_delivery_order_details: area/type/time on an
   * open job, plus address, unit and notes once it's the viewer's. Null when
   * they couldn't be loaded.
   */
  delivery: OrderDeliveryDetails | null;
}


export interface DeliveryRiderDetails {
  full_name: string | null;
  phone: string | null;
  photo_url: string | null;
  vehicle_type: string | null;
  license_plate: string | null;
}

/**
 * Where and when an order goes — the delivery fields the Customer app saves
 * on `orders` at checkout (delivery_type, scheduled_for, the address snapshot
 * delivery_address_line / delivery_unit / delivery_notes, customer_postal_code).
 *
 * Every field is optional: orders placed before those Customer app migrations
 * have none of them, and riders only get the exact address once they've
 * accepted (get_delivery_order_details in docs/supabase-order-delivery-details.sql).
 * Kept free of React/Next.js imports so it can be tested with node --test.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type DeliveryType = "normal" | "express";

export interface OrderDeliveryDetails {
  delivery_type?: string | null;
  /** Null = as soon as possible. */
  scheduled_for?: string | null;
  delivery_address_line?: string | null;
  delivery_unit?: string | null;
  delivery_notes?: string | null;
  /** Full 6-digit code — cooks, and the rider once assigned. */
  customer_postal_code?: string | null;
  /** First 2 digits only — what a rider sees on an open job. */
  customer_postal_sector?: string | null;
}

export interface DeliveryDestination {
  /** Address line, or the best fallback for an old order / an open job. */
  address: string;
  unit: string | null;
  notes: string | null;
}

export const ASAP_LABEL = "As soon as possible";

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function isExpress(details: OrderDeliveryDetails): boolean {
  return details.delivery_type === "express";
}

/**
 * "Requested for Mon 19 Oct, 6:30 pm" (Singapore time, whatever the device's
 * zone), or "As soon as possible" when there's no scheduled time.
 */
export function formatScheduledFor(iso: string | null | undefined): string {
  if (!clean(iso)) return ASAP_LABEL;
  const date = new Date(iso!);
  if (Number.isNaN(date.getTime())) return "Requested time unavailable";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Singapore",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return `Requested for ${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toLowerCase()}`;
}

/**
 * Address line, unit and notes. Old orders without the snapshot fall back to
 * the postal code, then the postal sector, so a card always has something.
 */
export function deliveryDestination(details: OrderDeliveryDetails): DeliveryDestination {
  const line = clean(details.delivery_address_line);
  const postalCode = clean(details.customer_postal_code);
  const sector = clean(details.customer_postal_sector);
  const address =
    line ??
    (postalCode ? `Singapore ${postalCode}` : sector ? `Postal sector ${sector}` : "No delivery address on this order");
  return { address, unit: clean(details.delivery_unit), notes: clean(details.delivery_notes) };
}

type DetailsRow = OrderDeliveryDetails & { delivery_request_id: string };

/**
 * Riders can't read orders directly, so their cards get these fields from
 * get_delivery_order_details — the drop-off area for open jobs, the full
 * address only for the rider's own accepted one. Keyed by delivery request id.
 * Null when the call fails (e.g. the SQL hasn't been run yet), so the card can
 * leave the section out rather than show "As soon as possible" for a job that
 * might be scheduled.
 */
export async function loadDeliveryOrderDetails(
  client: Pick<SupabaseClient, "rpc">,
  requestIds: string[]
): Promise<Record<string, OrderDeliveryDetails> | null> {
  if (requestIds.length === 0) return {};
  try {
    const { data, error } = await client.rpc("get_delivery_order_details", { p_delivery_request_ids: requestIds });
    if (error || !Array.isArray(data)) return null;
    const byId: Record<string, OrderDeliveryDetails> = {};
    for (const { delivery_request_id, ...details } of data as DetailsRow[]) byId[delivery_request_id] = details;
    return byId;
  } catch {
    return null;
  }
}

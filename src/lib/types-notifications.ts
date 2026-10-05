/**
 * Notification types — mirrors the `notifications` / `notification_preferences`
 * tables in `docs/supabase-notifications.sql`.
 */

export type NotificationCategory = "orders" | "deliveries" | "pickups" | "account";

export interface AppNotification {
  id: string;
  user_id: string;
  category: NotificationCategory;
  type: string;
  title: string;
  body: string | null;
  url: string;
  ref_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationPrefs {
  orders: boolean;
  deliveries: boolean;
  pickups: boolean;
  sound: boolean;
  /** Riders / pickers: off = don't broadcast new requests to me. */
  on_duty: boolean;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  orders: true,
  deliveries: true,
  pickups: true,
  sound: true,
  on_duty: true,
};

/** Which mutable categories matter to each role (account alerts can't be muted). */
export const CATEGORIES_BY_ROLE: Record<string, { key: "orders" | "deliveries" | "pickups"; label: string; hint: string }[]> = {
  cook: [
    { key: "orders", label: "New orders", hint: "New, cancelled and waiting orders" },
    { key: "deliveries", label: "Delivery updates", hint: "Rider accepted, dropped or delivered" },
  ],
  rider: [
    { key: "deliveries", label: "Delivery requests", hint: "New requests from kitchens" },
    { key: "pickups", label: "Picker updates", hint: "Picker accepted or handed off" },
  ],
  picker: [{ key: "pickups", label: "Pickup requests", hint: "New requests from riders" }],
};

/** Roles that get the "available for requests" (on duty) switch. */
export const BROADCAST_ROLES = ["rider", "picker"];

export type PushState =
  | "loading"
  | "unconfigured" // no VAPID public key in this build
  | "unsupported" // browser can't do Web Push
  | "needs-install" // iPhone/iPad Safari tab: push only works once added to the Home Screen
  | "blocked" // user denied the permission prompt
  | "off"
  | "on";

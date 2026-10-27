export type ApplicationStatus = "pending" | "approved" | "rejected";

export interface Profile {
  id: string;
  // 'picker' is a retired role: old accounts may still have it in the
  // database, but the app never offers or routes to it.
  role: "customer" | "cook" | "rider" | "picker" | "admin";
  full_name: string | null;
  phone: string | null;
  photo_url: string | null;
  is_active: boolean;
}

export interface CookApplication {
  id: string;
  user_id: string;
  business_name: string;
  business_type: string | null;
  description: string | null;
  /** Legacy — no longer collected; replaced by business_address + postal_code. */
  neighbourhood: string | null;
  business_address: string | null;
  postal_code: string | null;
  paynow_uen: string | null;
  business_uen: string | null;
  status: ApplicationStatus;
  created_at: string;
  // Privacy Policy acknowledgement (docs/supabase-privacy-consent.sql): the
  // time is the database's. Optional: older applications and reads before
  // that SQL has run don't have them.
  privacy_policy_version?: string | null;
  privacy_acknowledged_at?: string | null;
}

export interface RiderApplication {
  id: string;
  user_id: string;
  vehicle_type: string | null;
  license_plate: string | null;
  photo_url: string | null;
  status: ApplicationStatus;
  created_at: string;
  // As on CookApplication, plus the optional GPS consent given at sign-up.
  // Only a record: tracking still needs the per-job consent
  // (rider_location_consent).
  privacy_policy_version?: string | null;
  privacy_acknowledged_at?: string | null;
  gps_consent?: boolean | null;
  gps_consent_at?: string | null;
}

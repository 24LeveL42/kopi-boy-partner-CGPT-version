export type ApplicationStatus = "pending" | "approved" | "rejected";

export interface Profile {
  id: string;
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
}

export interface RiderApplication {
  id: string;
  user_id: string;
  vehicle_type: string | null;
  license_plate: string | null;
  photo_url: string | null;
  status: ApplicationStatus;
  created_at: string;
}

export interface PickerApplication {
  id: string;
  user_id: string;
  note: string | null;
  photo_url: string | null;
  status: ApplicationStatus;
  created_at: string;
}

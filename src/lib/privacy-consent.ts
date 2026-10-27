/**
 * The Privacy Policy acknowledgement on the cook and rider applications, and
 * the rider's optional GPS consent (docs/supabase-privacy-consent.sql).
 *
 * The form only sends the policy version and the rider's yes/no; the
 * database stamps privacy_acknowledged_at and gps_consent_at with its own
 * now() and refuses an application without the version. The GPS answer is
 * only recorded: tracking still needs the rider's per-job consent
 * (RiderTrackingShare / rider_location_consent).
 *
 * The wording below is Kopi Boy's own — keep it verbatim. Bump
 * PRIVACY_POLICY_VERSION whenever it or the policy changes.
 */

import type { PartnerRole } from "./types";

export const PRIVACY_POLICY_VERSION = "2026-10-v1";

/**
 * Where the Privacy Policy lives. Leave null until the real page exists: the
 * "Read Privacy Policy" link is then left out rather than pointing nowhere
 * (same rule as the Customer app's legal-links.ts).
 */
export const PRIVACY_POLICY_URL: string | null = null;

export const PRIVACY_LINK_LABEL = "Read Privacy Policy";

export const PRIVACY_CHECKBOX = "I acknowledge that I have read and understood Kopi Boy's Privacy Policy.";

export interface PrivacyCopy {
  heading: string;
  subheading: string;
  intro: string;
  lead: string;
  points: string[];
}

export const COOK_PRIVACY_COPY: PrivacyCopy = {
  heading: "Privacy Policy Acknowledgement",
  subheading: "Your Privacy Matters to Us",
  intro:
    "At Kopi Boy, we respect your privacy and are committed to protecting your personal and business-related information in accordance with Singapore's Personal Data Protection Act 2012 (PDPA).",
  lead: "By registering as a Merchant Partner, you acknowledge that:",
  points: [
    "Kopi Boy may collect and use your registration details, contact information, business information, and order-related data for account management, order facilitation, communication, and platform operations.",
    "Relevant information may be shared with customers and delivery partners where necessary to facilitate orders and deliveries.",
    "Your personal data will be handled in accordance with our Privacy Policy and applicable data protection requirements.",
    "You may contact Kopi Boy regarding your personal data and applicable data protection rights.",
  ],
};

export const RIDER_PRIVACY_COPY: PrivacyCopy = {
  heading: "Privacy Policy & Location Sharing Acknowledgement",
  subheading: "Your Privacy. Your Choice.",
  intro: "At Kopi Boy, we respect your privacy and independence as a Delivery Partner.",
  lead: "By registering as a Delivery Partner, you acknowledge that:",
  points: [
    "Kopi Boy may collect and use your registration details, contact information, and delivery-related information for account management, delivery facilitation, communication, and platform operations.",
    "You are free to choose when to be available and which delivery requests to accept.",
    "GPS location sharing is optional and controlled by you.",
    "When you voluntarily enable GPS tracking during an active delivery, your live location may be viewed by the relevant Customer, Merchant, and authorised Kopi Boy Administrator.",
    "Location sharing automatically stops when you mark the delivery as Delivered.",
    "Your personal data will be handled in accordance with our Privacy Policy and applicable data protection requirements.",
  ],
};

export const GPS_CONSENT_COPY = {
  subheading: "Optional GPS Location Sharing Consent",
  checkbox:
    "I consent to Kopi Boy collecting and sharing my live GPS location with the relevant Customer, Merchant, and authorised Kopi Boy Administrator during active deliveries when I voluntarily enable location sharing.",
  note: "GPS sharing is optional. You may choose not to enable it.",
};

export const PRIVACY_REQUIRED_MESSAGE = "Please tick the Privacy Policy acknowledgement before submitting.";

export function privacyCopyFor(role: PartnerRole): PrivacyCopy {
  return role === "rider" ? RIDER_PRIVACY_COPY : COOK_PRIVACY_COPY;
}

/** The consent fields sent with an application; null when the required box isn't ticked. */
export function consentFields(
  role: PartnerRole,
  acknowledged: boolean,
  gpsConsent: boolean
): { privacy_policy_version: string; gps_consent?: boolean } | null {
  if (!acknowledged) return null;
  return role === "rider"
    ? { privacy_policy_version: PRIVACY_POLICY_VERSION, gps_consent: gpsConsent }
    : { privacy_policy_version: PRIVACY_POLICY_VERSION };
}

const CONSENT_COLUMNS = ["privacy_policy_version", "gps_consent"];

/**
 * Whether an application insert failed only because the consent columns
 * don't exist yet (the app is deployed before the SQL): PostgREST's
 * PGRST204 "Could not find the '…' column", or Postgres's 42703. The
 * database's own refusal (23514, "Please confirm…") is not this.
 */
export function isMissingConsentColumns(error: { code?: string; message?: string } | null): boolean {
  if (!error || (error.code !== "PGRST204" && error.code !== "42703")) return false;
  const message = error.message ?? "";
  return CONSENT_COLUMNS.some((c) => message.includes(c));
}

/** The application row without the consent fields, for the retry before the SQL has run. */
export function withoutConsentFields<T extends Record<string, unknown>>(row: T): Omit<T, "privacy_policy_version" | "gps_consent"> {
  const rest: Record<string, unknown> = { ...row };
  for (const c of CONSENT_COLUMNS) delete rest[c];
  return rest as Omit<T, "privacy_policy_version" | "gps_consent">;
}

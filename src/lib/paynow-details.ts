/**
 * PayNow details on the cook application: a PayNow mobile number, a PayNow
 * UEN, or both. At least one is needed; if both are given, the UEN is the
 * one customers pay (it pre-fills Kitchen Setup, where the cook can change it).
 *
 * Must stay in sync with check_cook_application_paynow() in
 * docs/supabase-paynow-mobile.sql, which normalises the mobile number the
 * same way on insert — this copy gives the form its early, friendly error.
 *
 * Customers never see these application values: payment instructions come
 * from kitchens.paynow_type / paynow_value (get_order_paynow), saved in
 * Kitchen Setup. A mobile number is stored as 8 digits, no +65, because the
 * Customer app shows it as "+65 <number>".
 */

export type PaynowType = "mobile" | "uen";

export type PaynowField = "paynow_mobile" | "paynow_uen";

export interface PaynowProblem {
  field: PaynowField;
  /** Short, stable code for registration tracking — never the typed value. */
  code: "paynow_missing" | "invalid_mobile" | "invalid_uen";
  message: string;
}

const MOBILE_PATTERN = /^[89]\d{7}$/;

// ACRA formats: businesses (8 digits + letter), local companies (4-digit
// year + 5 digits + letter), other entities (T/S/R + 2 digits + 2 letters +
// 4 digits + letter). Same as src/lib/business-uen.ts.
const UEN_PATTERN = /^(\d{8}[A-Z]|\d{9}[A-Z]|[TSR]\d{2}[A-Z]{2}\d{4}[A-Z])$/;

/** "+65 9123 4567", "65-9123-4567", "91234567" → "91234567". Spaces, dashes, dots and brackets are ignored. */
export function normalizePaynowMobile(raw: string): string {
  let digits = raw.trim().replace(/[\s\-().]/g, "");
  if (digits.startsWith("+65")) digits = digits.slice(3);
  else if (digits.startsWith("65") && digits.length === 10) digits = digits.slice(2);
  return digits;
}

/** Trimmed, upper-case, inner spaces removed. */
export function normalizePaynowUen(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toUpperCase();
}

export function isValidPaynowMobile(raw: string): boolean {
  return MOBILE_PATTERN.test(normalizePaynowMobile(raw));
}

export function isValidPaynowUen(raw: string): boolean {
  return UEN_PATTERN.test(normalizePaynowUen(raw));
}

/** Why these PayNow details can't be submitted, or null if they're fine. */
export function paynowProblem(mobileRaw: string, uenRaw: string): PaynowProblem | null {
  const mobile = mobileRaw.trim();
  const uen = uenRaw.trim();
  if (!mobile && !uen) {
    return {
      field: "paynow_mobile",
      code: "paynow_missing",
      message: "Please add how customers can pay you: a PayNow mobile number or a PayNow UEN (one is enough).",
    };
  }
  if (mobile && !isValidPaynowMobile(mobile)) {
    return {
      field: "paynow_mobile",
      code: "invalid_mobile",
      message: "Your PayNow mobile number should be 8 digits starting with 8 or 9 (e.g. 91234567).",
    };
  }
  if (uen && !isValidPaynowUen(uen)) {
    return {
      field: "paynow_uen",
      code: "invalid_uen",
      message: "That PayNow UEN doesn't look right. It's usually 9 or 10 characters, e.g. 53123456X, 202412345K or T24LL1234A.",
    };
  }
  return null;
}

/** The values to store on the application (null when left empty). Call only after paynowProblem() returned null. */
export function paynowApplicationFields(mobileRaw: string, uenRaw: string): { paynow_mobile: string | null; paynow_uen: string | null } {
  const mobile = mobileRaw.trim() ? normalizePaynowMobile(mobileRaw) : "";
  const uen = uenRaw.trim() ? normalizePaynowUen(uenRaw) : "";
  return { paynow_mobile: mobile || null, paynow_uen: uen || null };
}

/**
 * The PayNow method to pre-fill in first-time Kitchen Setup from the
 * application: the UEN if it's a valid one, else the mobile number. Older
 * applications had one free-text "PayNow UEN" box, so a value there that is
 * really a mobile number is pre-filled as a mobile number, and anything that
 * is neither is not pre-filled at all (the cook types it in Kitchen Setup).
 */
export function paynowPrefill(app: { paynow_uen: string | null; paynow_mobile?: string | null }): { type: PaynowType; value: string } | null {
  const uen = app.paynow_uen ?? "";
  const mobile = app.paynow_mobile ?? "";
  if (uen && isValidPaynowUen(uen)) return { type: "uen", value: normalizePaynowUen(uen) };
  if (mobile && isValidPaynowMobile(mobile)) return { type: "mobile", value: normalizePaynowMobile(mobile) };
  if (uen && isValidPaynowMobile(uen)) return { type: "mobile", value: normalizePaynowMobile(uen) };
  return null;
}

/** The insert failed only because paynow_mobile doesn't exist yet (docs/supabase-paynow-mobile.sql not run). */
export function isMissingPaynowMobileColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error || (error.code !== "PGRST204" && error.code !== "42703")) return false;
  return (error.message ?? "").includes("paynow_mobile");
}

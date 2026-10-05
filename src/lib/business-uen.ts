// Must stay in sync with check_cook_application_uen() in
// docs/supabase-schema.sql (section 26), which enforces the same rules on
// insert — this copy only gives the form an early, friendly error.

/** Only home cooks may apply without a Business Registration Number. */
export function requiresBusinessUen(businessType: string): boolean {
  return businessType !== "Home Cook";
}

export function normalizeBusinessUen(raw: string): string {
  return raw.trim().toUpperCase();
}

// ACRA formats: businesses (8 digits + letter), local companies (4-digit year
// + 5 digits + letter), other entities (T/S/R + 2 digits + 2 letters + 4
// digits + letter).
const UEN_PATTERN = /^(\d{8}[A-Z]|\d{9}[A-Z]|[TSR]\d{2}[A-Z]{2}\d{4}[A-Z])$/;

/** Returns why this UEN can't be submitted for `businessType`, or null if it's fine (or not needed). */
export function businessUenProblem(businessType: string, raw: string): string | null {
  if (!requiresBusinessUen(businessType)) return null;
  const uen = normalizeBusinessUen(raw);
  if (!uen) return "Please enter your Business Registration Number (UEN).";
  if (!UEN_PATTERN.test(uen)) return "That doesn't look like a valid UEN (e.g. 53123456X or 201912345K).";
  return null;
}

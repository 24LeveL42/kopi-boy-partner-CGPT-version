/**
 * Email one-time-code sign-in (Supabase Auth signInWithOtp + verifyOtp).
 * Offered inside in-app browsers (Facebook, Instagram, TikTok…), where
 * Google refuses to sign anyone in. The code is typed into the same screen,
 * so the session lands in the browser the person is already in — a link in
 * the email would open in a different browser.
 *
 * The same email as a Google account signs in to that same account
 * (Supabase links one confirmed email to one user).
 *
 * Code length: set in Supabase (Auth → Email OTP length, 6–10 digits).
 * Nothing here assumes 6: any 6–10 digit code is sent to Supabase, which
 * decides whether it's right.
 *
 * Pure module (no React, no Supabase import) so `node --test` can load it.
 */

export type EmailIntent = "signup" | "signin";

/** Short, stable codes for the email_code_error funnel event — never the typed value. */
export type EmailCodeErrorCode = "invalid_email" | "no_account" | "rate_limited" | "send_failed" | "code_rejected" | "verify_failed";

/** Seconds before "Resend code" can be tapped again. */
export const RESEND_WAIT_SECONDS = 60;

/** Supabase lets a project set an email code length of 6 to 10 digits. */
export const MIN_CODE_LENGTH = 6;
export const MAX_CODE_LENGTH = 10;

export const EMAIL_CODE_COPY = {
  continueWithEmail: "Continue with email",
  emailLabel: "Email address",
  hint: "Use the same email as your Google account.",
  sendCode: "Send code",
  sending: "Sending…",
  sentTo: "We sent a code to",
  checkSpam: "It can take a minute to arrive. Check your spam or promotions folder too.",
  codeLabel: "Code from the email",
  verify: "Continue",
  verifying: "Checking…",
  resend: "Resend code",
  resendIn: (seconds: number) => `Resend code in ${seconds}s`,
  resent: "We sent a new code. Use the newest email.",
  differentEmail: "Use a different email",
  orGoogle: "or",
  incompleteCode: "Please enter the whole code from the email.",
} as const;

export const EMAIL_CODE_ERRORS: Record<EmailCodeErrorCode, string> = {
  invalid_email: "That email address doesn't look right. Please check it and try again.",
  no_account: "No account with this email. Tap Sign up instead.",
  rate_limited: "Too many tries. Please wait a minute, then try again.",
  send_failed: "We couldn't send the code. Check your connection and try again.",
  code_rejected: "That code didn't work. It may be mistyped or expired. Check the newest email, or tap Resend code.",
  verify_failed: "We couldn't check the code. Check your connection and try again.",
};

/** Trimmed, lower case. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** A light check for obvious typos; Supabase does the real one. */
export function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(raw));
}

/** Digits only (spaces or dashes pasted from the email are dropped), at most MAX_CODE_LENGTH. */
export function cleanCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, MAX_CODE_LENGTH);
}

export function isCompleteCode(code: string): boolean {
  return code.length >= MIN_CODE_LENGTH && code.length <= MAX_CODE_LENGTH && /^\d+$/.test(code);
}

/**
 * Options for signInWithOtp. "Sign in" never creates an account, so a
 * mistyped or different email gets "No account…" instead of a new, empty
 * account. "Sign up" creates it (or signs in, if the email already has one).
 */
export function otpOptions(intent: EmailIntent): { shouldCreateUser: boolean } {
  return { shouldCreateUser: intent === "signup" };
}

type AuthErrorLike = { code?: string; status?: number; message?: string } | null | undefined;

const isRateLimited = (e: NonNullable<AuthErrorLike>) =>
  e.status === 429 || e.code === "over_email_send_rate_limit" || e.code === "over_request_rate_limit";

/** What went wrong sending the code, or null if it was sent. */
export function sendCodeError(error: AuthErrorLike, intent: EmailIntent): EmailCodeErrorCode | null {
  if (!error) return null;
  if (isRateLimited(error)) return "rate_limited";
  if (error.code === "email_address_invalid") return "invalid_email";
  // shouldCreateUser: false and no such user → Supabase says "Signups not
  // allowed for otp" (otp_disabled, 422).
  if (intent === "signin" && (error.code === "otp_disabled" || error.code === "user_not_found" || error.code === "signup_disabled")) {
    return "no_account";
  }
  return "send_failed";
}

/**
 * What went wrong checking the code, or null if signed in. Supabase answers
 * a wrong code and an expired one the same way (otp_expired, "Token has
 * expired or is invalid"), so both get one message.
 */
export function verifyCodeError(error: AuthErrorLike): EmailCodeErrorCode | null {
  if (!error) return null;
  if (isRateLimited(error)) return "rate_limited";
  if (error.code === "otp_expired" || error.status === 403 || error.status === 400 || error.status === 422) return "code_rejected";
  return "verify_failed";
}

/** Whole seconds until Resend can be tapped (0 = now). */
export function resendSecondsLeft(sentAt: number | null, now: number): number {
  if (sentAt === null) return 0;
  return Math.max(0, Math.ceil((sentAt + RESEND_WAIT_SECONDS * 1000 - now) / 1000));
}

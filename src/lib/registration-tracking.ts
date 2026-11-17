/**
 * Cook registration funnel tracking (where do new cooks give up?).
 *
 * What is recorded: an anonymous random session id (one per browser tab,
 * never tied to the account), the event type, and for some events a field
 * NAME, its step number in the form, or a short error code. Never what the
 * cook typed, never their user id, never their IP (the database function
 * stores no request data). See docs/supabase-registration-tracking.sql.
 *
 * Cost: each event is sent at most once per session (de-duplicated here and
 * again by a unique index), events are batched (one request per few
 * seconds, or when the tab is hidden/closed), and a session can send at most
 * MAX_EVENTS_PER_SESSION events. Nothing is sent on keystrokes: "field
 * reached" fires on the first focus of each field only.
 *
 * Failure-proof: sending is fire-and-forget. Every error (network, missing
 * database function before the SQL has run, storage blocked) is swallowed,
 * and the form never waits for it.
 *
 * "Abandoned" = the form was started, there is no submit_success, and the
 * session has been inactive for ABANDON_AFTER_MINUTES. The browser also sends
 * an explicit `abandon` event (with the last field touched) when the tab is
 * closed or navigated away from, which tells Boss where they stopped.
 */

export const REGISTRATION_FORM = "cook";

/** Inactivity after which a started, unsubmitted session counts as abandoned (used by the Boss report). */
export const ABANDON_AFTER_MINUTES = 30;

export const MAX_EVENTS_PER_SESSION = 60;
export const MAX_BATCH = 20;
export const FLUSH_DELAY_MS = 5000;

export type RegistrationEventType =
  // Sign-in screen (signed out; shared by cook and rider applicants and by
  // existing partners signing back in — see existing_account below).
  | "signin_view" // the sign-in screen was shown
  | "in_app_browser" // shown inside an in-app browser (Facebook, Instagram, Messenger, TikTok, WeChat, LINE), where Google sign-in is refused
  | "chose_sign_up" // tapped "Sign up — I'm new"
  | "chose_sign_in" // tapped "Sign in — I already have an account"
  | "signin_click" // tapped the Google button (leaving for Google)
  | "signin_error" // code: google_error | auth_failed | google_slow
  | "existing_account" // after sign-in, this account already has an application or is a partner: not a new sign-up
  // Partner sign-up and the cook form (signed in, no application yet).
  | "page_view" // the "Join as a partner" screen (role choice) was shown
  | "cook_form_view" // "I'm a cook" was chosen: the cook form is on screen
  | "rider_form_view" // "I'm a rider" was chosen (not tracked further; lets Boss leave riders out)
  | "form_start" // first focus on any cook field
  | "field_reached" // first focus on a given field (field + step)
  | "submit_attempt" // "Submit application" pressed
  | "validation_error" // field + error code
  | "submit_success"
  | "abandon"; // tab closed / left with the form started and not submitted (field = last one touched)

/**
 * The cook form's fields, in on-screen order. The step number is the
 * position here (1-based), so Boss can show the funnel in order.
 * business_uen only appears for registered businesses (not Home Cook).
 */
export const COOK_FORM_FIELDS = [
  "full_name",
  "contact_number",
  "business_name",
  "business_type",
  "business_uen",
  "business_address",
  "postal_code",
  "paynow_mobile",
  "paynow_uen",
  "privacy_ack",
] as const;

export type CookFormField = (typeof COOK_FORM_FIELDS)[number];

export type ValidationCode =
  | "required"
  | "invalid_format"
  | "invalid_postal_code"
  | "invalid_business_uen"
  | "paynow_missing"
  | "invalid_mobile"
  | "invalid_uen"
  | "privacy_required"
  | "server_error"
  // Sign-in screen (signin_error only).
  | "google_error"
  | "auth_failed"
  | "google_slow";

export type SigninErrorCode = "google_error" | "auth_failed" | "google_slow";

export interface RegistrationEvent {
  event: RegistrationEventType;
  field?: CookFormField;
  step?: number;
  code?: ValidationCode;
}

export function stepOf(field: CookFormField): number {
  return COOK_FORM_FIELDS.indexOf(field) + 1;
}

export function isCookFormField(name: string): name is CookFormField {
  return (COOK_FORM_FIELDS as readonly string[]).includes(name);
}

/** One key per thing counted once per session. */
export function eventKey(e: RegistrationEvent): string {
  return `${e.event}|${e.field ?? ""}|${e.code ?? ""}`;
}

export type SendBatch = (events: RegistrationEvent[], options: { keepalive: boolean }) => Promise<unknown>;

interface TrackerOptions {
  send: SendBatch;
  flushDelayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * De-duplicating, batching queue. Pure (no browser globals) so it can be unit
 * tested; createBrowserTracker() wires it to fetch and the page lifecycle.
 */
export class RegistrationTracker {
  private seen = new Set<string>();
  private queue: RegistrationEvent[] = [];
  private sent = 0;
  private timer: unknown = null;
  private started = false;
  private submitted = false;
  private lastField: CookFormField | null = null;
  private readonly send: SendBatch;
  private readonly flushDelayMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(options: TrackerOptions) {
    this.send = options.send;
    this.flushDelayMs = options.flushDelayMs ?? FLUSH_DELAY_MS;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  track(e: RegistrationEvent): void {
    try {
      if (this.submitted && e.event !== "submit_success") return;
      const key = eventKey(e);
      if (this.seen.has(key)) return;
      if (this.sent + this.queue.length >= MAX_EVENTS_PER_SESSION) return;
      this.seen.add(key);
      this.queue.push(e);
      if (e.event === "submit_success") {
        this.submitted = true;
        this.flush(false);
        return;
      }
      if (this.queue.length >= MAX_BATCH) this.flush(false);
      else if (this.timer === null) this.timer = this.setTimer(() => this.flush(false), this.flushDelayMs);
    } catch {
      // Tracking never gets in the way.
    }
  }

  /** First focus on a cook form field: form_start once, then field_reached once per field. */
  fieldFocused(field: CookFormField): void {
    this.lastField = field;
    if (!this.started) {
      this.started = true;
      this.track({ event: "form_start" });
    }
    this.track({ event: "field_reached", field, step: stepOf(field) });
  }

  validationError(field: CookFormField, code: ValidationCode): void {
    this.track({ event: "validation_error", field, step: stepOf(field), code });
  }

  /** The tab is going away: record where they stopped (if they started and didn't finish), then send. */
  leaving(): void {
    if (this.started && !this.submitted) {
      const field = this.lastField ?? undefined;
      this.track({ event: "abandon", field, step: field ? stepOf(field) : undefined });
    }
    this.flush(true);
  }

  flush(keepalive: boolean): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    this.sent += batch.length;
    try {
      this.send(batch, { keepalive }).catch(() => {});
    } catch {
      // Ignore: see the file comment.
    }
  }
}

const SESSION_KEY = "kb_reg_session";
const TEST_KEY = "kb_reg_test";
const SIGNIN_KEY = "kb_reg_signin";

/**
 * The sign-in screen was tracked in this tab. After Google, the next screen
 * either shows the partner sign-up (page_view: a new applicant) or, for an
 * account that already has an application or is a partner, records one
 * existing_account event — only in a tab that came through the sign-in
 * screen, so everyday use of the app sends nothing.
 */
export function markSigninTracked(): void {
  try {
    window.sessionStorage.setItem(SIGNIN_KEY, "1");
  } catch {}
}

/** True once per tab after markSigninTracked(); clears it. */
export function takeSigninTracked(): boolean {
  try {
    const was = window.sessionStorage.getItem(SIGNIN_KEY) === "1";
    window.sessionStorage.removeItem(SIGNIN_KEY);
    return was;
  } catch {
    return false;
  }
}

/** HQ signed in on this device: never count it again (same as ?kb_test=1). */
export function markTestDevice(): void {
  try {
    window.localStorage.setItem(TEST_KEY, "1");
  } catch {}
}

/**
 * A test session is never counted: localhost, a dev build, or a device marked
 * with ?kb_test=1 on any Partner page (remembered on that device until
 * ?kb_test=0). Admin accounts never see the registration form at all.
 */
export function isTestSession(input: { hostname: string; search: string; stored: string | null; production: boolean }): boolean {
  const flag = new URLSearchParams(input.search).get("kb_test");
  if (flag === "1") return true;
  if (flag === "0") return false;
  if (!input.production) return true;
  if (/^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])$/.test(input.hostname)) return true;
  return input.stored === "1";
}

function safeStorage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // RFC 4122 v4 from Math.random — only for very old browsers; uniqueness, not secrecy, is what matters.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Per-tab session id: survives a reload (so a reload isn't a new visitor), not a new tab or a later visit. */
function sessionId(): string {
  const store = safeStorage("session");
  try {
    const existing = store?.getItem(SESSION_KEY);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  } catch {}
  const id = randomId();
  try {
    store?.setItem(SESSION_KEY, id);
  } catch {}
  return id;
}

function testSession(): boolean {
  const local = safeStorage("local");
  let stored: string | null = null;
  try {
    stored = local?.getItem(TEST_KEY) ?? null;
  } catch {}
  const flag = new URLSearchParams(window.location.search).get("kb_test");
  try {
    if (flag === "1") local?.setItem(TEST_KEY, "1");
    if (flag === "0") local?.removeItem(TEST_KEY);
  } catch {}
  return isTestSession({
    hostname: window.location.hostname,
    search: window.location.search,
    stored,
    production: process.env.NODE_ENV === "production",
  });
}

/**
 * Posts straight to the log_registration_events() RPC with only the public
 * publishable key (no user token), so the request runs as `anon` and the
 * event can't be linked to the account. fetch keepalive lets the last batch
 * leave even while the tab is closing.
 */
function browserSender(session: string, isTest: boolean): SendBatch {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return async (events, { keepalive }) => {
    if (!url || !key) return;
    const headers: Record<string, string> = { "Content-Type": "application/json", apikey: key };
    // Legacy anon keys are JWTs and also go in Authorization; publishable keys don't.
    if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
    await fetch(`${url}/rest/v1/rpc/log_registration_events`, {
      method: "POST",
      headers,
      keepalive,
      credentials: "omit",
      body: JSON.stringify({ p_session_id: session, p_form: REGISTRATION_FORM, p_is_test: isTest, p_events: events }),
    });
  };
}

/** Wires a tracker to fetch and the page lifecycle. Returns a no-op-safe tracker plus a cleanup function. */
export function createBrowserTracker(options: { forceTest?: boolean } = {}): { tracker: RegistrationTracker; dispose: () => void } {
  let send: SendBatch = async () => {};
  try {
    send = browserSender(sessionId(), options.forceTest === true || testSession());
  } catch {}
  const tracker = new RegistrationTracker({ send });
  const onHide = () => {
    if (document.visibilityState === "hidden") tracker.flush(true);
  };
  const onPageHide = () => tracker.leaving();
  try {
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
  } catch {}
  return {
    tracker,
    dispose: () => {
      try {
        document.removeEventListener("visibilitychange", onHide);
        window.removeEventListener("pagehide", onPageHide);
      } catch {}
      tracker.flush(true);
    },
  };
}

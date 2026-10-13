// Must stay in sync with docs/supabase-admin-messages.sql (the
// admin_messages_message_length check and the 5-per-24h insert trigger).

export const ADMIN_MESSAGE_MAX_LENGTH = 500;

export type AdminMessageStatus = "open" | "replied" | "closed";

/** A partner's message to HQ and HQ's reply — mirrors `admin_messages`. */
export interface AdminMessage {
  id: string;
  sender_id: string;
  sender_role: string | null;
  message: string;
  admin_reply: string | null;
  replied_at: string | null;
  status: AdminMessageStatus;
  created_at: string;
}

/** Shown on the full-screen page a blocked cook / rider / picker lands on. */
export const BLOCKED_SCREEN_COPY = {
  title: "Your account is blocked",
  body: "Please contact the admin below. You can't accept deliveries until your account is unblocked.",
} as const;

export const ADMIN_MESSAGE_STATUS_LABEL: Record<AdminMessageStatus, string> = {
  open: "Waiting for reply",
  replied: "Replied",
  closed: "Closed",
};

/**
 * Length as Postgres' char_length counts it (code points), so an emoji is 1
 * here just as it is in the database check — `string.length` would say 2.
 */
export function adminMessageLength(text: string): number {
  return Array.from(text).length;
}

export type AdminMessageValidation = { ok: true; message: string } | { ok: false; error: string };

export function validateAdminMessage(raw: string): AdminMessageValidation {
  const message = String(raw ?? "").trim();
  if (!message) return { ok: false, error: "Please write a message first." };
  const length = adminMessageLength(message);
  if (length > ADMIN_MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Please keep your message to ${ADMIN_MESSAGE_MAX_LENGTH} characters (it's ${length} now).`,
    };
  }
  return { ok: true, message };
}

export function sortAdminMessagesNewestFirst(messages: AdminMessage[]): AdminMessage[] {
  return [...messages].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/**
 * Turns a failed insert into something to show the sender. The rate-limit
 * trigger's message is already written for people, so it's passed through;
 * anything else gets a generic line rather than a raw database error.
 */
export function adminMessageSendErrorText(error: { code?: string; message?: string; hint?: string | null }): string {
  if (error.hint === "admin_messages_rate_limit" && error.message) return error.message;
  return "Your message couldn't be sent. Please check your connection and try again.";
}

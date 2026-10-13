"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { usePendingAction } from "@/lib/use-pending-action";
import { PendingLabel } from "./Pending";
import {
  ADMIN_MESSAGE_MAX_LENGTH,
  ADMIN_MESSAGE_STATUS_LABEL,
  adminMessageLength,
  adminMessageSendErrorText,
  sortAdminMessagesNewestFirst,
  validateAdminMessage,
  type AdminMessage,
} from "@/lib/admin-messages";

const HISTORY_LIMIT = 20;

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("en-SG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/**
 * Message box + history for a blocked partner talking to HQ. Works while
 * blocked: admin_messages' RLS only checks sender_id = auth.uid(), never
 * is_active (docs/supabase-admin-messages.sql).
 */
export function AdminMessagePanel({ userId }: { userId: string }) {
  const supabase = createClient();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const { busy, run } = usePendingAction();

  const load = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from("admin_messages")
      .select("*")
      .eq("sender_id", userId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT)
      .returns<AdminMessage[]>();
    setLoadError(!!fetchError);
    if (!fetchError) setMessages(sortAdminMessagesNewestFirst(data ?? []));
    setLoading(false);
  }, [supabase, userId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  // HQ's reply shows up without a reload.
  useLiveRefresh([{ table: "admin_messages", filter: `sender_id=eq.${userId}` }], () => void load());

  const length = adminMessageLength(draft.trim());
  const tooLong = length > ADMIN_MESSAGE_MAX_LENGTH;

  function send(e: React.FormEvent) {
    e.preventDefault();
    const checked = validateAdminMessage(draft);
    if (!checked.ok) {
      setSent(false);
      setError(checked.error);
      return;
    }
    run("send", async () => {
      setError(null);
      setSent(false);
      const { error: insertError } = await supabase
        .from("admin_messages")
        .insert({ sender_id: userId, message: checked.message });
      if (insertError) {
        setError(adminMessageSendErrorText(insertError));
        return;
      }
      setDraft("");
      setSent(true);
      await load();
    });
  }

  return (
    <div className="text-left">
      <form onSubmit={send}>
        <label htmlFor="admin-message" className="text-sm font-bold" style={{ color: "var(--kb-ink)" }}>
          Message the admin
        </label>
        <textarea
          id="admin-message"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
            setSent(false);
          }}
          maxLength={ADMIN_MESSAGE_MAX_LENGTH}
          rows={4}
          placeholder="Write your message here"
          className="kb-input mt-2 resize-none"
          aria-describedby="admin-message-count"
        />
        <p
          id="admin-message-count"
          className="mt-1 text-right text-xs"
          style={{ color: tooLong ? "var(--kb-danger)" : "var(--kb-ink-soft)" }}
        >
          {length}/{ADMIN_MESSAGE_MAX_LENGTH}
        </p>

        {error && (
          <p role="alert" className="kb-alert-error mt-2 rounded-2xl px-4 py-3 text-sm">
            {error}
          </p>
        )}
        {sent && (
          <p role="status" className="kb-alert-success mt-2 rounded-2xl px-4 py-3 text-sm">
            Message sent. The admin&apos;s reply will appear below.
          </p>
        )}

        <button type="submit" disabled={busy || length === 0 || tooLong} className="kb-btn-primary mt-3 w-full py-3 text-sm">
          <PendingLabel pending={busy} pendingText="Sending…">Send to admin</PendingLabel>
        </button>
      </form>

      <div className="mt-6">
        <p className="kb-eyebrow">Your messages</p>
        {loading ? (
          <p className="mt-2 text-sm" style={{ color: "var(--kb-ink-soft)" }}>Loading…</p>
        ) : loadError ? (
          <p className="mt-2 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
            Couldn&apos;t load your messages. Check your connection.
          </p>
        ) : messages.length === 0 ? (
          <p className="mt-2 text-sm" style={{ color: "var(--kb-ink-soft)" }}>No messages yet.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {messages.map((m) => (
              <li key={m.id} className="rounded-2xl border p-3" style={{ borderColor: "#ECEAF1", background: "#FFFFFF" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                    You · {formatTime(m.created_at)}
                  </span>
                  <span className="kb-pill">{ADMIN_MESSAGE_STATUS_LABEL[m.status] ?? m.status}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm" style={{ color: "var(--kb-ink)" }}>
                  {m.message}
                </p>
                {m.admin_reply ? (
                  <div className="mt-2 rounded-xl px-3 py-2" style={{ background: "#F4EEFF" }}>
                    <p className="text-xs font-semibold" style={{ color: "var(--kb-purple)" }}>
                      Admin{m.replied_at ? ` · ${formatTime(m.replied_at)}` : ""}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm" style={{ color: "var(--kb-ink)" }}>
                      {m.admin_reply}
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-xs italic" style={{ color: "var(--kb-ink-soft)" }}>No reply yet.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

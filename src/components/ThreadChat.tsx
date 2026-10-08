"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePendingAction } from "@/lib/use-pending-action";
import { PendingLabel } from "./Pending";
import type { ChatMessage } from "@/lib/types-messages";
import {
  MESSAGE_BODY_MAX_LENGTH,
  ORDER_CHAT_PHOTO_TYPES,
  ORDER_CHAT_PHOTO_URL_TTL_SECONDS,
  normalizeOrderChatBody,
  uploadChatPhoto,
  validateOrderChatPhoto,
} from "@/lib/order-chat-photo";

const MESSAGE_LIMIT = 200;

/** Where a chat's rows and photos live — see OrderChat / PickupChat. */
export interface ThreadChatConfig {
  /** Immutable chat table (select + insert only). */
  table: "messages" | "pickup_messages" | "partner_rider_messages";
  /** Column on `table` that ties a row to its thread. */
  threadColumn: "order_id" | "pickup_request_id" | "delivery_request_id";
  /** Private bucket; object keys are `<threadId>/<uploader>/<random>.<ext>`. */
  bucket: string;
  title: string;
  /** Sender label for the other participant's messages. */
  otherLabel: string;
  emptyText: string;
  placeholder: string;
  /** Whether photos can be attached and shown. Defaults to true; false makes the chat text only. */
  allowPhotos?: boolean;
}

/**
 * Simple two-person chat box for one thread (an order's delivery, or a
 * pickup request). Mounted only while its thread is accepted (the caller
 * controls that); RLS backs the same rule server-side, so if the thread goes
 * terminal mid-conversation the next load/realtime event just returns
 * nothing instead of erroring.
 *
 * Photos live in the config's private bucket; a message stores the object
 * key and this component swaps it for a short-lived signed URL.
 */
export function ThreadChat({ config, threadId, userId }: { config: ThreadChatConfig; threadId: string; userId: string }) {
  const { table, threadColumn, bucket } = config;
  const allowPhotos = config.allowPhotos ?? true;
  const [supabase] = useState(() => createClient());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const { busy: sending, run } = usePendingAction();
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestedPathsRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const { data } = await supabase
      .from(table)
      .select("*")
      .eq(threadColumn, threadId)
      .order("created_at", { ascending: true })
      .limit(MESSAGE_LIMIT)
      .returns<ChatMessage[]>();
    if (data) setMessages(data);
  }, [supabase, table, threadColumn, threadId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`${table}:${threadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table, filter: `${threadColumn}=eq.${threadId}` },
        (payload) => {
          const m = payload.new as ChatMessage;
          setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m].slice(-MESSAGE_LIMIT)));
        }
      )
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [supabase, table, threadColumn, threadId, load]);

  // Sign any photo keys we haven't signed yet, in one batch per change.
  useEffect(() => {
    if (!allowPhotos) return;
    const missing = messages
      .map((m) => m.photo_path)
      .filter((p): p is string => Boolean(p) && !requestedPathsRef.current.has(p!));
    if (missing.length === 0) return;
    for (const p of missing) requestedPathsRef.current.add(p);
    let cancelled = false;
    void supabase.storage
      .from(bucket)
      .createSignedUrls(missing, ORDER_CHAT_PHOTO_URL_TTL_SECONDS)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const signed: Record<string, string> = {};
        for (const item of data) if (item.path && item.signedUrl) signed[item.path] = item.signedUrl;
        setPhotoUrls((prev) => ({ ...prev, ...signed }));
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, bucket, messages, allowPhotos]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  function handlePhotoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = ""; // so picking the same file again still fires onChange
    if (!file) return;
    const problem = validateOrderChatPhoto(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setPhoto(file);
  }

  function send() {
    const attached = allowPhotos ? photo : null;
    const body = normalizeOrderChatBody(draft, attached !== null);
    if (body === null || sending) return;
    run("send", async () => {
      setError(null);

      let photoPath: string | null = null;
      if (attached) {
        const upload = await uploadChatPhoto(supabase, bucket, threadId, userId, attached);
        if (upload.error !== null) {
          setError(`Photo couldn't be uploaded: ${upload.error}`);
          return;
        }
        photoPath = upload.path;
      }

      const row: Record<string, string | null> = { [threadColumn]: threadId, sender_id: userId, body };
      if (allowPhotos) row.photo_path = photoPath;
      const { error: sendError } = await supabase.from(table).insert(row);
      if (sendError) {
        setError(sendError.message);
        return;
      }
      setDraft("");
      setPhoto(null);
    });
  }

  const canSend = !sending && normalizeOrderChatBody(draft, allowPhotos && photo !== null) !== null;

  return (
    <div className="mt-3 rounded-2xl border bg-white p-3 shadow-[0_5px_16px_rgba(34,22,56,0.045)]" style={{ color: "var(--kb-ink)", borderColor: "var(--kb-line)" }}>
      <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--kb-purple)" }}>
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--kb-green)" }} />
        {config.title}
      </p>

      <div ref={listRef} className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <p className="py-2 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
            {config.emptyText}
          </p>
        ) : (
          messages.map((m) => {
            // You on the right, the other participant on the left.
            const mine = m.sender_id === userId;
            const url = m.photo_path ? photoUrls[m.photo_path] : undefined;
            return (
              <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                <span className="mb-0.5 px-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--kb-ink-soft)" }}>
                  {mine ? "You" : config.otherLabel}
                </span>
                <div
                  className={`max-w-[80%] overflow-hidden rounded-2xl text-sm break-words ${mine ? "rounded-tr-md" : "rounded-tl-md"}`}
                  style={
                    mine
                      ? { background: "linear-gradient(135deg, var(--kb-purple) 0%, #8B5CF6 100%)", color: "white" }
                      : { background: "#F5F3FA", color: "var(--kb-ink)" }
                  }
                >
                  {allowPhotos &&
                    m.photo_path &&
                    (url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        {/* Short-lived signed URL from a private bucket — next/image can't (and shouldn't) cache it. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="Attached photo" className="max-h-48 w-full object-cover" />
                      </a>
                    ) : (
                      <span className="block px-3 py-1.5 text-xs opacity-80">Loading photo…</span>
                    ))}
                  {m.body && <p className="px-3 py-1.5">{m.body}</p>}
                </div>
              </div>
            );
          })
        )}
      </div>

      {error && (
        <p className="kb-alert-error mt-2 rounded-xl px-3 py-1.5 text-xs">
          {error}
        </p>
      )}

      {allowPhotos && photo && (
        <div
          className="mt-2 flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-xs"
          style={{ background: "var(--kb-tint)" }}
        >
          <span className="truncate">📎 {photo.name}</span>
          <button
            type="button"
            onClick={() => setPhoto(null)}
            disabled={sending}
            className="shrink-0 font-semibold disabled:opacity-60"
            style={{ color: "var(--kb-danger)" }}
          >
            Remove
          </button>
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        {allowPhotos && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ORDER_CHAT_PHOTO_TYPES.join(",")}
              onChange={handlePhotoPicked}
              className="hidden"
              aria-label="Attach photo"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              aria-label="Attach a photo"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl disabled:opacity-60"
              style={{ background: "var(--kb-tint)", color: "var(--kb-purple)" }}
            >
              <CameraIcon />
            </button>
          </>
        )}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          readOnly={sending} // what's typed now would be wiped when the send lands
          placeholder={config.placeholder}
          maxLength={MESSAGE_BODY_MAX_LENGTH}
          className="min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:border-[#7B3FE4]/45 focus:bg-white"
          style={{ borderColor: "rgba(124,58,237,0.12)", background: "var(--kb-field)", color: "var(--kb-ink)" }}
        />
        <button
          onClick={send}
          disabled={!canSend}
          className="kb-btn-primary shrink-0 rounded-xl px-4 py-2.5 text-sm"
        >
          <PendingLabel pending={sending} pendingText="Sending…">Send</PendingLabel>
        </button>
      </div>
    </div>
  );
}

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

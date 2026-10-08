"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useNotifications } from "./NotificationsProvider";
import { PendingLabel } from "./Pending";
import { readLastPush, type LastPush } from "@/lib/push-client";
import { usePendingAction } from "@/lib/use-pending-action";
import { BROADCAST_ROLES, CATEGORIES_BY_ROLE, type AppNotification } from "@/lib/types-notifications";

function timeAgo(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        {hint && (
          <p className="text-xs" style={{ color: "var(--kb-ink-soft)" }}>
            {hint}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
        style={{ background: checked ? "var(--kb-gradient)" : "#DCD8E5" }}
      >
        <span
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
          style={{ left: checked ? "1.375rem" : "0.125rem" }}
        />
      </button>
    </div>
  );
}

const PUSH_COPY = {
  loading: null,
  unconfigured: "Alerts when the app is closed aren't set up on this build yet.",
  unsupported: "This browser can't send alerts when the app is closed. You'll still get them while the app is open.",
  "needs-install": "On iPhone, alerts only work once the app is added to your Home Screen: tap Share, then Add to Home Screen, and open it from there.",
  blocked: "Notifications are blocked for this app. Allow them in your browser or phone settings, then come back.",
  off: "Get an alert on this device even when the app is closed.",
  on: "This device will get alerts even when the app is closed.",
} as const;

export function NotificationsCenter({ role }: { role: string }) {
  const router = useRouter();
  const { items, unreadCount, markRead, markAllRead, prefs, updatePrefs, pushState, pushError, turnOnPush, turnOffPush } =
    useNotifications();
  const push = usePendingAction();

  // Re-read when the app comes back to the front, so "background it, send a
  // push, return" shows whether the service worker handled that push.
  const [lastPush, setLastPush] = useState<LastPush | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void readLastPush().then((p) => live && setLastPush(p));
    load();
    document.addEventListener("visibilitychange", load);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  const categories = CATEGORIES_BY_ROLE[role] ?? [];
  const showDuty = BROADCAST_ROLES.includes(role);

  function open(n: AppNotification) {
    void markRead(n.id);
    router.push(n.url);
  }

  return (
    <div className="space-y-4">
      <section className="kb-card p-5">
        <p className="kb-eyebrow">Settings</p>
        <h2 className="mt-1 font-display text-lg font-bold">Alerts on this device</h2>
        {PUSH_COPY[pushState] && (
          <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
            {PUSH_COPY[pushState]}
          </p>
        )}
        {(pushState === "off" || pushState === "on") && (
          <button
            type="button"
            onClick={() => push.run("push", pushState === "off" ? turnOnPush : turnOffPush)}
            disabled={push.busy}
            className={`${pushState === "off" ? "kb-btn-primary" : "kb-btn-ghost"} mt-3 w-full py-3 text-sm`}
          >
            <PendingLabel pending={push.busy} pendingText={pushState === "off" ? "Turning on…" : "Turning off…"}>
              {pushState === "off" ? "Turn on notifications" : "Turn off notifications"}
            </PendingLabel>
          </button>
        )}
        {pushState === "on" && (
          <p className="mt-2 text-[11px]" style={{ color: "var(--kb-ink-soft)" }}>
            {lastPush
              ? `Last push reached this device at ${new Date(lastPush.at).toLocaleTimeString()}: ${lastPush.result}${lastPush.error ? ` (${lastPush.error.slice(0, 120)})` : ""}.`
              : "No push has reached this device yet."}
          </p>
        )}
        {pushError && (
          <p className="kb-alert-error mt-2 rounded-xl px-3 py-2 text-xs">
            {pushError}
          </p>
        )}

        <div className="mt-3 divide-y divide-[#ECEAF1] border-t" style={{ borderColor: "var(--kb-line)" }}>
          {showDuty && (
            <Switch
              label="Available for requests"
              hint="Off = no new request alerts (you're off shift)"
              checked={prefs.on_duty}
              onChange={(v) => void updatePrefs({ on_duty: v })}
            />
          )}
          {categories.map((c) => (
            <Switch
              key={c.key}
              label={c.label}
              hint={c.hint}
              checked={prefs[c.key]}
              onChange={(v) => void updatePrefs({ [c.key]: v })}
            />
          ))}
          <Switch
            label="Sound"
            hint="Chime when an alert arrives while the app is open"
            checked={prefs.sound}
            onChange={(v) => void updatePrefs({ sound: v })}
          />
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
          Account alerts (approved, blocked) are always on.
        </p>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <div>
            <p className="kb-eyebrow">Updates</p>
            <h2 className="mt-1 font-display text-lg font-bold" style={{ color: "var(--kb-ink)" }}>
              Inbox
            </h2>
          </div>
          {unreadCount > 0 && (
            <button type="button" onClick={() => void markAllRead()} className="kb-btn-secondary px-3 py-2 text-xs">
              Mark all read
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <p className="kb-card mt-3 p-5 text-center text-sm" style={{ color: "var(--kb-ink-soft)" }}>
            Nothing yet — new orders, deliveries and updates will show up here.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className="flex w-full items-start gap-3 rounded-2xl border bg-white p-4 text-left shadow-[0_5px_16px_rgba(34,22,56,0.045)] transition hover:-translate-y-0.5 hover:shadow-md"
                  style={{ color: "var(--kb-ink)", borderColor: n.read_at ? "var(--kb-line)" : "rgba(124,58,237,0.22)" }}
                >
                  <span
                    aria-label={n.read_at ? "Read" : "Unread"}
                    className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: n.read_at ? "transparent" : "var(--kb-purple)" }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${n.read_at ? "font-medium" : "font-bold"}`}>{n.title}</span>
                    {n.body && (
                      <span className="mt-0.5 block text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                        {n.body}
                      </span>
                    )}
                    <span className="mt-1 block text-[11px]" style={{ color: "var(--kb-ink-soft)" }}>
                      {timeAgo(n.created_at)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

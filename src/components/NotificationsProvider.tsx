"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { playChime, unlockAudio } from "@/lib/notification-sound";
import { detectPushState, disablePush, enablePush, registerServiceWorker, syncPushSubscription } from "@/lib/push-client";
import {
  DEFAULT_PREFS,
  type AppNotification,
  type NotificationPrefs,
  type PushState,
} from "@/lib/types-notifications";

const INBOX_LIMIT = 50;
const TOAST_MS = 7000;

interface NotificationsValue {
  signedIn: boolean;
  items: AppNotification[];
  unreadCount: number;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  prefs: NotificationPrefs;
  updatePrefs: (patch: Partial<NotificationPrefs>) => Promise<void>;
  pushState: PushState;
  pushError: string | null;
  turnOnPush: () => Promise<void>;
  turnOffPush: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsValue | null>(null);

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used inside <NotificationsProvider>");
  return ctx;
}

/**
 * Owns everything notification-related for the signed-in user: the inbox
 * (loaded + kept live over Supabase Realtime), toasts / chime / vibration for
 * new arrivals, per-category preferences, and Web Push registration. Mounted
 * once in the root layout so it keeps running across page navigations.
 */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const [pushState, setPushState] = useState<PushState>("loading");
  const [pushError, setPushError] = useState<string | null>(null);

  // Realtime callbacks are created once per sign-in; read the latest prefs
  // through a ref instead of re-subscribing whenever a switch is toggled.
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  // --- who is signed in -----------------------------------------------------
  useEffect(() => {
    let live = true;
    supabase.auth.getSession().then(({ data }) => {
      if (live) setUserId(data.session?.user.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });
    return () => {
      live = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  // --- browsers only allow audio after a first tap --------------------------
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // --- toasts ---------------------------------------------------------------
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (n: AppNotification) => {
      setToasts((prev) => [n, ...prev.filter((t) => t.id !== n.id)].slice(0, 3));
      setTimeout(() => dismissToast(n.id), TOAST_MS);
    },
    [dismissToast]
  );

  // --- inbox + realtime -----------------------------------------------------
  const loadInbox = useCallback(async () => {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(INBOX_LIMIT)
      .returns<AppNotification[]>();
    if (data) setItems(data);
  }, [supabase]);

  useEffect(() => {
    if (!userId) return;
    let live = true;

    supabase
      .from("notification_preferences")
      .select("orders, deliveries, pickups, sound, on_duty")
      .eq("user_id", userId)
      .maybeSingle<NotificationPrefs>()
      .then(({ data }) => {
        if (live) setPrefs({ ...DEFAULT_PREFS, ...(data ?? {}) });
      });

    // Deferred like the dashboards' loads, so no setState runs synchronously
    // as part of this effect's own commit.
    const initial = setTimeout(() => void loadInbox(), 0);

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as AppNotification;
          setItems((prev) => (prev.some((p) => p.id === n.id) ? prev : [n, ...prev].slice(0, INBOX_LIMIT)));
          showToast(n);
          if (prefsRef.current.sound) playChime();
          navigator.vibrate?.([200, 100, 200]);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as AppNotification;
          setItems((prev) => prev.map((p) => (p.id === n.id ? n : p)));
        }
      )
      .subscribe();

    // A backgrounded tab can miss socket events; catch up when it returns.
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadInbox();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      live = false;
      clearTimeout(initial);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
      // Signed out / switched account: don't leave the last user's inbox behind.
      setItems([]);
      setToasts([]);
      setPrefs(DEFAULT_PREFS);
    };
  }, [userId, supabase, loadInbox, showToast]);

  // --- push -----------------------------------------------------------------
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    (async () => {
      try {
        await syncPushSubscription(supabase);
      } catch (err) {
        console.error("Push sync failed:", err);
      }
      const state = await detectPushState();
      if (live) setPushState(state);
    })();
    return () => {
      live = false;
    };
  }, [userId, supabase]);

  const turnOnPush = useCallback(async () => {
    setPushError(null);
    try {
      setPushState(await enablePush(supabase));
    } catch (err) {
      console.error("Enabling push failed:", err);
      // Supabase errors are plain objects, not Error instances, so read name/message/code off either.
      const { name, message, code } = err as { name?: string; message?: string; code?: string };
      const reason = [name && name !== "Error" ? name : code, message].filter(Boolean).join(": ");
      setPushError(`Couldn't turn on notifications${reason ? ` (${reason.slice(0, 160)})` : ""}. Please try again.`);
      setPushState(await detectPushState());
    }
  }, [supabase]);

  const turnOffPush = useCallback(async () => {
    setPushError(null);
    try {
      setPushState(await disablePush(supabase));
    } catch (err) {
      console.error("Disabling push failed:", err);
      setPushError("Couldn't turn off notifications. Please try again.");
    }
  }, [supabase]);

  // --- read state -----------------------------------------------------------
  const unreadCount = useMemo(() => items.filter((n) => !n.read_at).length, [items]);

  // App-icon badge on installed PWAs (Android / desktop / iOS 16.4+).
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (unreadCount > 0) void nav.setAppBadge?.(unreadCount).catch(() => {});
    else void nav.clearAppBadge?.().catch(() => {});
  }, [unreadCount]);

  const markRead = useCallback(
    async (id: string) => {
      const now = new Date().toISOString();
      setItems((prev) => prev.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: now } : n)));
      await supabase.from("notifications").update({ read_at: now }).eq("id", id).is("read_at", null);
    },
    [supabase]
  );

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    await supabase.from("notifications").update({ read_at: now }).is("read_at", null);
  }, [supabase]);

  const updatePrefs = useCallback(
    async (patch: Partial<NotificationPrefs>) => {
      if (!userId) return;
      setPrefs((prev) => ({ ...prev, ...patch }));
      const { error } = await supabase
        .from("notification_preferences")
        .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) {
        console.error("Saving notification preferences failed:", error);
        // Roll back to what the database actually has.
        const { data } = await supabase
          .from("notification_preferences")
          .select("orders, deliveries, pickups, sound, on_duty")
          .eq("user_id", userId)
          .maybeSingle<NotificationPrefs>();
        setPrefs({ ...DEFAULT_PREFS, ...(data ?? {}) });
      }
    },
    [supabase, userId]
  );

  const value = useMemo<NotificationsValue>(
    () => ({
      signedIn: !!userId,
      items,
      unreadCount,
      markRead,
      markAllRead,
      prefs,
      updatePrefs,
      pushState,
      pushError,
      turnOnPush,
      turnOffPush,
    }),
    [userId, items, unreadCount, markRead, markAllRead, prefs, updatePrefs, pushState, pushError, turnOnPush, turnOffPush]
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}

      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 z-[45] mx-auto flex max-w-md flex-col gap-2 px-4 sm:max-w-lg sm:px-6"
        style={{ top: "calc(var(--app-bar-h) + 0.5rem)" }}
      >
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              dismissToast(t.id);
              void markRead(t.id);
              router.push(t.url);
            }}
            className="pointer-events-auto rounded-2xl border px-4 py-3 text-left shadow-lg"
            style={{ background: "var(--kb-navy-raised)", borderColor: "var(--kb-green)", color: "var(--kb-on-navy)" }}
          >
            <span className="block text-sm font-semibold">{t.title}</span>
            {t.body && (
              <span className="mt-0.5 block text-xs" style={{ color: "var(--kb-on-navy-soft)" }}>
                {t.body}
              </span>
            )}
          </button>
        ))}
      </div>
    </NotificationsContext.Provider>
  );
}

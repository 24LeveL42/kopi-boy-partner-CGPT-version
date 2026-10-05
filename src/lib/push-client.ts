import type { SupabaseClient } from "@supabase/supabase-js";
import type { PushState } from "./types-notifications";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64: string) {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function pushApisPresent() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function isIosBrowserTab() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch (err) {
    console.error("Service worker registration failed:", err);
    return null;
  }
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export interface LastPush {
  at: string;
  title: string;
  result: string;
  error?: string;
}

/** The last push the service worker handled on this device (written by public/sw.js). */
export async function readLastPush(): Promise<LastPush | null> {
  try {
    if (!("caches" in window)) return null;
    const res = await (await caches.open("kb-push-log")).match("/__push-last");
    return res ? ((await res.json()) as LastPush) : null;
  } catch {
    return null;
  }
}

/** What the "Turn on notifications" control should show right now. */
export async function detectPushState(): Promise<PushState> {
  if (!VAPID_PUBLIC_KEY) return "unconfigured";
  if (!pushApisPresent()) return isIosBrowserTab() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission === "granted" && (await currentSubscription())) return "on";
  return "off";
}

async function saveSubscription(supabase: SupabaseClient, sub: PushSubscription) {
  const json = sub.toJSON();
  const { error } = await supabase.rpc("register_push_subscription", {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? "",
    p_auth: json.keys?.auth ?? "",
    p_user_agent: navigator.userAgent.slice(0, 200),
  });
  if (error) throw error;
}

/**
 * Must be called from a tap (browsers reject permission prompts that aren't
 * user-initiated). Returns the resulting state.
 */
export async function enablePush(supabase: SupabaseClient): Promise<PushState> {
  if (!VAPID_PUBLIC_KEY) return "unconfigured";
  if (!pushApisPresent()) return isIosBrowserTab() ? "needs-install" : "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";

  await registerServiceWorker();
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }));
  await saveSubscription(supabase, sub);
  return "on";
}

export async function disablePush(supabase: SupabaseClient): Promise<PushState> {
  const sub = await currentSubscription();
  if (sub) {
    await supabase.rpc("unregister_push_subscription", { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
  return "off";
}

/**
 * On sign-in: if this browser already allowed push, (re)assign its
 * subscription to whoever is signed in now, so a shared device never keeps
 * delivering the previous account's alerts.
 */
export async function syncPushSubscription(supabase: SupabaseClient) {
  if (!VAPID_PUBLIC_KEY || !pushApisPresent() || Notification.permission !== "granted") return;
  const sub = await currentSubscription();
  if (sub) await saveSubscription(supabase, sub);
}

/** On sign-out: stop this device receiving the signed-out account's alerts. */
export async function removeDeviceSubscription(supabase: SupabaseClient) {
  try {
    if (!pushApisPresent()) return;
    const sub = await currentSubscription();
    if (sub) await supabase.rpc("unregister_push_subscription", { p_endpoint: sub.endpoint });
  } catch {
    // best effort — sign-out must never be blocked by this
  }
}

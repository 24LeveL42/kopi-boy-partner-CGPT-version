/* Kopi Boy Partner — service worker. Handles Web Push only (no offline caching). */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// The last push this device received and what happened to it. The app reads it
// (Notifications page) so a "no notification appeared" report can be split into
// "push never reached the service worker" vs "it did, and showNotification
// resolved/failed" without USB debugging. Not an offline cache.
async function recordPush(entry) {
  try {
    const cache = await caches.open("kb-push-log");
    await cache.put(
      "/__push-last",
      new Response(JSON.stringify(entry), { headers: { "Content-Type": "application/json" } })
    );
  } catch {
    // diagnostics only — never let logging break a notification
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Kopi Boy Partner";
  const urgent = data.category === "orders" || data.category === "deliveries" || data.category === "pickups";
  const at = new Date().toISOString();

  // Always show something, whether or not any page is open: browsers (iOS
  // especially) revoke a push subscription that receives pushes without
  // displaying them. `tag` collapses a repeat of the same notification instead
  // of stacking it.
  event.waitUntil(
    (async () => {
      await recordPush({ at, title, result: "received" });
      try {
        await self.registration.showNotification(title, {
          body: data.body || "",
          icon: "/icons/icon-192.png",
          badge: "/icons/badge-72.png",
          tag: data.tag || undefined,
          renotify: !!data.tag,
          vibrate: [200, 100, 200],
          requireInteraction: urgent,
          data: { url: data.url || "/" },
        });
        await recordPush({ at, title, result: "shown" });
      } catch (err) {
        // A rejected option must not cost the user the notification: retry bare.
        try {
          await self.registration.showNotification(title, {
            body: data.body || "",
            tag: data.tag || undefined,
            data: { url: data.url || "/" },
          });
          await recordPush({ at, title, result: "shown (retried without icon/vibrate options)", error: String(err) });
        } catch (err2) {
          await recordPush({ at, title, result: "showNotification failed", error: String(err2) });
        }
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(target);
            } catch {
              // cross-context navigate can fail; the focused app is still fine
            }
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});

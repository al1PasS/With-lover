// Notification-only worker: no fetch handler, Cache API, or private storage.
const notificationTag = "shiguang-updates";
async function refreshBadge(count) {
  try {
    if (count > 0) await self.navigator.setAppBadge?.(count);
    else await self.navigator.clearAppBadge?.();
  } catch {
    /* Some devices use the system notification itself as the badge. */
  }
}
self.addEventListener("install", (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch("/api/v1/push/status", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          await refreshBadge(0);
        return;
      }
      const state = await response.json();
      await refreshBadge(state.unread);
      if (!state.enabled || !state.unread) return;
      await self.registration.showNotification("拾光有新动态", {
        body: "打开拾光，看看对方留下的新消息。",
        icon: "/images/app-192.png",
        tag: notificationTag,
      });
      for (const client of await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })) {
        client.postMessage({ type: "shiguang:push" });
      }
    })().catch(() => {}),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const url = new URL("/?updates=1", self.location.origin).href;
      for (const client of await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })) {
        if (client.url.startsWith(self.location.origin + "/")) {
          await client.navigate(url);
          await client.focus();
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

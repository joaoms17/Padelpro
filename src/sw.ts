/// <reference lib="webworker" />
// Custom service worker (vite-plugin-pwa injectManifest): Workbox precaching
// plus Web Push handling for Contas a Dois notifications (spec 10).
import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener("push", (event: PushEvent) => {
  let data: { title?: string; body?: string; url?: string } = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  const title = data.title ?? "Contas a Dois";
  const options: NotificationOptions = {
    body: data.body ?? "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url ?? "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) {
          void (c as WindowClient).navigate(url);
          return (c as WindowClient).focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

self.addEventListener("message", (event: ExtendableMessageEvent) => {
  if (event.data === "SKIP_WAITING") void self.skipWaiting();
});

// Service worker: shows Web Push alerts sent by supabase/functions/daily-alerts and opens the app on tap.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'HatchPro', { body: d.body || '', tag: 'hatchpro-alert', renotify: true, data: { url: d.url || '/more/notifications' } }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href; // same-origin only
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    const w = ws.find((x) => x.url === url && 'focus' in x);
    return w ? w.focus() : self.clients.openWindow(url);
  }));
});

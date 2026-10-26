// Service worker: offline copies of visited pages + app code, and Web Push alerts (supabase/functions/daily-alerts).
// Network first everywhere (online behaves exactly as without the worker, dev HMR stays fresh); the cached copy is
// used only when the network fails. Sign-out clears the caches (components/shell/SignOutButton.tsx).
const CACHE = 'hp-offline-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin) return;
  const page = r.mode === 'navigate' && !/^\/(api|login|platform|apply|auth)(\/|$)/.test(u.pathname);
  if (!page && !u.pathname.startsWith('/_next/static/')) return;
  e.respondWith(fetch(r).then((res) => {
    if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); }
    return res;
  }).catch(() => caches.match(r).then((hit) => hit || Response.error())));
});

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

const CACHE = "kirk-v13";
const ASSETS = [
  "./", "./index.html", "./style.css",
  "./app.js", "./api.js", "./audio.js",
  "./tts.js", "./chat.js", "./config.js",
  "./manifest.json", "./icon-192.png",
  "./user-avatar.jpg", "./kirk-avatar.jpg"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('push', event => {
  let title = 'Kirk Monitor';
  let body = 'Notifica dal sistema';
  if (event.data) {
    try {
      const d = event.data.json();
      title = d.title || title;
      body = d.body || body;
    } catch (_) {
      body = event.data.text();
    }
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/kirk-webapp/icon-192.png',
      badge: '/kirk-webapp/icon-192.png',
      tag: 'kirk-monitor',
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/kirk-webapp/'));
});

// Network-first: sempre file freschi dalla rete, cache solo se offline
self.addEventListener("fetch", (e) => {
  if (e.request.url.includes("cfargotunnel.com") || e.request.url.includes("ngrok")) return;
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});

// v18 (01/09/2026): 📎 Allega file — galleria, download, OneDrive via selettore
//   di sistema; max 50 MB a file, 5 per deposito; le immagini diventano foto.
// v17 (30/08/2026): Kirk e' SOLO il Deposito — chat dismessa, registro dei
//   depositi, saluto vocale con audio ricordato, icona Enterprise.
// ⚠️ Il numero di versione va SEMPRE alzato quando cambia un file della PWA:
//    senza bump il telefono continua a servire la versione vecchia dalla cache.
//    E se si aggiunge un file nuovo, va messo anche in ASSETS.
const CACHE = "kirk-v18";
const ASSETS = [
  "./", "./index.html", "./style.css",
  "./app.js", "./api.js", "./audio.js",
  "./tts.js", "./config.js",
  "./biometric.js", "./deposito.js", "./coda.js",
  "./manifest.json", "./icon-192.png",
  "./kirk-avatar.jpg"
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

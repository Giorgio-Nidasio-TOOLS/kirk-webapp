const CACHE = "kirk-v10";
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

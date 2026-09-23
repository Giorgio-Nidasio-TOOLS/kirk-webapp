// v23 (23/09/2026): la coda che PERDE — incidente del 22/09 (voce di 107 s in coda con «3
//   tentativi» a PC spento, poi sparita senza consegna). Tre difese in coda.js: DIARIO della
//   coda in localStorage (mandato al PC con la verifica, stato «⚠️ sparito dalla coda»),
//   COPIA di ogni pacchetto nella cache "kirk-coda-copia" con ripristino automatico,
//   navigator.storage.persist(). Rilettura del record dopo l'accodamento.
//   ⚠️ La cache della COPIA NON va cancellata al cambio di versione: vedi activate.
// v22 (16/09/2026): un deposito perso si puo' DARE PER PERSO, con il motivo. Terzo stato nel
//   registro — «✕ perso, chiuso» — accanto a «sul PC» e «il PC non lo ha»: il PC lo dichiara
//   in data/depositi_rinunciati.json e /depositi/verifica lo restituisce con motivo e rimedio.
//   ⭐ Serve perche' una riga irrecuperabile teneva GIALLA per sempre la sentinella del Tool 04,
//   e un semaforo sempre acceso e' un semaforo spento.
// v21 (11/09/2026): deposito a prova di perdita — bozza su disco (testo, foto, allegati
//   e pezzi della voce man mano che nascono), registratore che sopravvive allo stop del
//   sistema, «Deposita» che ferma da solo la registrazione, errori grandi e persistenti,
//   registro CONFERMATO dal PC (/depositi/verifica), token sbagliato detto in chiaro.
// v20 (10/09/2026): chiave pubblica VAPID ruotata (audit 2026-09, M1) — solo config.js;
//   il bump serve perche' il telefono ricarichi config.js dalla rete e non dalla cache.
// v19 (01/09/2026): allegati con due selettori puliti — 🖼 Immagini (selettore
//   foto) e 📎 Documenti (selettore file con accept esplicito): via lo
//   "Scegli un'azione" ambiguo di Samsung. HEIC non decodificabile -> allegato.
// v18 (01/09/2026): 📎 Allega file — galleria, download, OneDrive via selettore
//   di sistema; max 50 MB a file, 5 per deposito; le immagini diventano foto.
// v17 (30/08/2026): Kirk e' SOLO il Deposito — chat dismessa, registro dei
//   depositi, saluto vocale con audio ricordato, icona Enterprise.
// ⚠️ Il numero di versione va SEMPRE alzato quando cambia un file della PWA:
//    senza bump il telefono continua a servire la versione vecchia dalla cache.
//    E se si aggiunge un file nuovo, va messo anche in ASSETS.
const CACHE = "kirk-v23";
// ⚠️ La copia dei pacchetti in coda (coda.js) vive in questa cache: NON e' una cache di
//    versione e non va MAI cancellata all'attivazione, o si butta via la rete di sicurezza.
const CACHE_COPIA = "kirk-coda-copia";
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
      Promise.all(keys.filter((k) => k !== CACHE && k !== CACHE_COPIA).map((k) => caches.delete(k)))
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

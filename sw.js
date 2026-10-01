// v25 (01/10/2026): le notifiche di Kirk piu' vecchie di 24 ore spariscono dalla tendina. A ogni
//   push, dopo averla mostrata, chiude quelle con timestamp (l'ora di partenza) piu' vecchio di
//   24 ore (registration.getNotifications() + close()); lo stesso fa notifiche.js all'apertura
//   della bacheca. Aprire la bacheca NON tocca la tendina — resta cosi'. Decisione di Giorgio
//   del 01/10/2026 h 19:21.
// v24 (02/10/2026): la BACHECA DELLE NOTIFICHE. Ogni push ha un tag suo («kirk-<id>»): le
//   notifiche si IMPILANO nella tendina invece di cancellarsi a vicenda (fino alla v23 il tag
//   era uno solo, 'kirk-monitor', e ogni push nuova sostituiva la precedente — Giorgio, 29/09:
//   «vedo solo la notifica singola»). Il titolo arriva dal PC («Forum · 16:59»); a ogni push le
//   finestre aperte di Kirk accendono il pallino della campanella; il tocco sulla push apre
//   Kirk con la bacheca gia' aperta su quella notifica. File nuovo: notifiche.js (in ASSETS).
// v23 (23/09/2026): la coda che PERDE — incidente del 22/09 (voce di 107 s in coda con «3
//   tentativi» a PC spento, poi sparita). Tre difese in coda.js: DIARIO della
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
const CACHE = "kirk-v25";
// ⚠️ La copia dei pacchetti in coda (coda.js) vive in questa cache: NON e' una cache di
//    versione e non va MAI cancellata all'attivazione, o si butta via la rete di sicurezza.
const CACHE_COPIA = "kirk-coda-copia";
const ASSETS = [
  "./", "./index.html", "./style.css",
  "./app.js", "./api.js", "./audio.js",
  "./tts.js", "./config.js",
  "./biometric.js", "./deposito.js", "./coda.js",
  "./notifiche.js",
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

// Un tag per notifica: senza id (PC vecchio, prova a mano) se ne inventa uno che non si ripete.
let _senzaId = 0;

// Pulizia della tendina: le notifiche di Kirk piu' vecchie di 24 ore si chiudono da sole
// (24 h, decisione di Giorgio del 01/10/2026 h 19:21).
const SOGLIA_PULIZIA_MS = 24 * 60 * 60 * 1000;

self.addEventListener("push", (event) => {
  let d = {};
  if (event.data) {
    try { d = event.data.json() || {}; } catch (_) { d = { body: event.data.text() }; }
  }
  const id = typeof d.id === "string" && d.id ? d.id : null;
  const opzioni = {
    body: d.body || "Notifica dal sistema",
    icon: "/kirk-webapp/icon-192.png",
    badge: "/kirk-webapp/icon-192.png",
    tag: "kirk-" + (id || `senza-id-${Date.now()}-${++_senzaId}`),
    data: { id },
  };
  if (typeof d.ts === "number") opzioni.timestamp = Math.round(d.ts * 1000);   // ora di PARTENZA
  event.waitUntil((async () => {
    await self.registration.showNotification(d.title || "Kirk", opzioni);
    const finestre = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const f of finestre) f.postMessage({ tipo: "notifica", id });
    // Pulizia DOPO il postMessage (giro di correzioni 1, 02/10/2026): una getNotifications()
    // lenta non deve ritardare il pallino sulla campanella.
    try {
      const soglia = Date.now() - SOGLIA_PULIZIA_MS;
      const inTendina = await self.registration.getNotifications();
      for (const n of inTendina) {
        if (n.tag === opzioni.tag) continue;   // la notifica appena mostrata non si chiude da sola
        if (typeof n.timestamp === "number" && n.timestamp < soglia) n.close();
      }
    } catch (_) { /* la pulizia non deve mai impedire ne' la notifica ne' il postMessage */ }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = (event.notification.data && event.notification.data.id) || null;
  event.waitUntil((async () => {
    const finestre = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const kirk = finestre.find((f) => String(f.url || "").includes("/kirk-webapp/"));
    if (kirk) {
      try { await kirk.focus(); } catch (_) { /* il sistema puo' negarlo: il messaggio parte lo stesso */ }
      if (id) kirk.postMessage({ tipo: "apri-notifica", id });
      return;
    }
    await self.clients.openWindow("/kirk-webapp/" + (id ? "?notifica=" + encodeURIComponent(id) : ""));
  })());
});

// Network-first: sempre file freschi dalla rete, cache solo se offline.
// v24: ignoreSearch, perche' il tocco su una push apre «/kirk-webapp/?notifica=<id>».
self.addEventListener("fetch", (e) => {
  if (e.request.url.includes("cfargotunnel.com") || e.request.url.includes("ngrok")) return;
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        return response;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

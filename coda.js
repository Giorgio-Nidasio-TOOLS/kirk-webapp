/**
 * Coda offline dei depositi + BOZZA del deposito in preparazione + DIARIO + COPIA.
 *
 * PERCHE' ESISTE: in fiera il campo non c'e' e il PC di Giorgio puo' essere spento.
 * Senza coda i depositi si perdono in silenzio — ed e' il fallimento peggiore,
 * perche' lo scopri a fiera finita.
 *
 * REGOLE:
 *  - un pacchetto esce dalla coda SOLO dopo un 200 del server
 *  - ogni pacchetto porta un client_id: il server lo usa per non duplicare
 *    (in fiera i ritenti sono la norma, non l'eccezione)
 *  - il pacchetto e' immutabile una volta accodato
 *  - IndexedDB, non localStorage: le foto superano la quota dei 5 MB
 *
 * LA BOZZA (dall'11/09/2026, dopo un deposito perso): tutto cio' che Giorgio
 * sta preparando — testo, foto, allegati e i pezzi della registrazione man
 * mano che nascono — vive su disco, non in memoria. Se Android chiude l'app,
 * se lo schermo si blocca, se il registratore muore, alla riapertura la bozza
 * e' li' e si puo' depositare. Si cancella SOLO quando il pacchetto e' in coda.
 *
 * IL DIARIO E LA COPIA (dal 23/09/2026, PWA v23 — incidente del 22/09/2026):
 * un deposito con 107 s di voce ERA in coda (Giorgio ha visto «3 tentativi» a
 * PC spento) e poi e' SPARITO dalla coda senza che il PC lo ricevesse mai.
 * ngrok a PC spento risponde 404 (provato), il codice cancella solo dopo un
 * 2xx con JSON: quindi e' stata la memoria del telefono (IndexedDB) a perdere il
 * record — Chrome, se trova il suo IndexedDB corrotto, lo ricrea vuoto in
 * silenzio. Tre difese, una sull'altra:
 *  1. DIARIO in localStorage (memoria diversa dalla coda): ogni evento della
 *     coda — accodato, tentativo, consegnato, ripristinato, copia fallita,
 *     persistenza — con ora locale. Va al PC con la verifica del registro e il
 *     PC lo conserva: la prossima volta la causa si LEGGE, non si deduce.
 *     Cio' che il diario dice «accodato» e non e' ne' in coda ne' «consegnato»
 *     e' SPARITO: la riga lo dice, il PC lo logga, il Tool 04 lo vede rosso.
 *  2. COPIA di ogni pacchetto nella Cache API (altro motore di memoria, altri
 *     file): se la coda perde il record, alla riapertura la copia lo RIMETTE
 *     in coda («ripristinato»). Si cancella solo dopo la consegna.
 *     ⚠️ sw.js NON deve cancellare la cache della copia quando cambia versione.
 *  3. navigator.storage.persist(): chiede al browser di non sfrattare questa
 *     origine quando lo spazio scarseggia.
 *  E accodare significa RILEGGERE: dopo la scrittura il record si rilegge; se
 *  non c'e', «Deposita» fallisce a voce alta e la bozza resta.
 */

const DB_NAME = "kirk-deposito";
const DB_VERSION = 2;          // v2 (11/09/2026): store "bozza"
const STORE = "coda";
const STORE_BOZZA = "bozza";
const BOZZA_ID = "corrente";

const ATTESE_MS = [5000, 15000, 60000, 300000, 900000]; // 5s, 15s, 1m, 5m, 15m

// Diario della coda (localStorage) e copia dei pacchetti (Cache API) — v23
const DIARIO_KEY = "kirk_diario_coda";
const DIARIO_MAX = 300;
const PERSIST_KEY = "kirk_storage_persist";
export const COPIA_CACHE = "kirk-coda-copia";   // ⚠️ esclusa dalla pulizia in sw.js
const COPIA_PREFIX = "/kirk-coda-copia/";

let _db = null;
let _timer = null;
let _inCorso = false;
let _onCambio = null;

// ── IndexedDB ────────────────────────────────────────────────────────────────

function _apri() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "client_id" });
      }
      if (!db.objectStoreNames.contains(STORE_BOZZA)) {
        db.createObjectStore(STORE_BOZZA, { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      // Se il browser chiude la connessione (sfratto, versione nuova), la prossima
      // chiamata la riapre invece di usare un handle morto.
      _db.onclose = () => { _db = null; };
      _db.onversionchange = () => { try { _db.close(); } catch { /* gia' chiusa */ } _db = null; };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

function _tx(modo, fn, store = STORE) {
  return _apri().then((db) => new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(store, modo);
    } catch (e) {
      _db = null;             // handle morto: la prossima volta si riapre
      reject(e);
      return;
    }
    const s = tx.objectStore(store);
    const req = fn(s);
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("transazione annullata"));
  }));
}

// ── Diario della coda (localStorage) ─────────────────────────────────────────

function _oraLocale() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
       + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Le voci del diario, dalla piu' vecchia alla piu' recente: [{t, id, ev, d}]. */
export function leggiDiario() {
  try {
    const arr = JSON.parse(localStorage.getItem(DIARIO_KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Scrive una voce nel diario. Non deve mai rompere la coda: ogni errore si tace. */
export function annota(client_id, evento, dettaglio = null) {
  try {
    const voci = leggiDiario();
    voci.push({ t: _oraLocale(), id: client_id || "-", ev: evento, d: dettaglio });
    while (voci.length > DIARIO_MAX) voci.shift();
    localStorage.setItem(DIARIO_KEY, JSON.stringify(voci));
  } catch { /* quota o storage assente: il diario e' una rete, non un cancello */ }
}

/**
 * Gli SPARITI: client_id che il diario dice «accodato» (o «ripristinato»), che
 * NON sono in coda e che il diario NON dice «consegnato». E' la firma
 * dell'incidente del 22/09/2026. I depositi precedenti al diario non possono
 * risultare spariti: senza «accodato» non c'e' prova che fossero in coda.
 */
export async function spariti() {
  const voci = leggiDiario();
  const accodati = new Set();
  const consegnati = new Set();
  for (const v of voci) {
    if (v.ev === "accodato" || v.ev === "ripristinato") accodati.add(v.id);
    if (v.ev === "consegnato") consegnati.add(v.id);
  }
  let inCoda = [];
  try { inCoda = await inAttesa(); } catch { return []; }
  const pendenti = new Set(inCoda.map((p) => p.client_id));
  return [...accodati].filter((id) => !consegnati.has(id) && !pendenti.has(id));
}

// ── Copia dei pacchetti (Cache API) ──────────────────────────────────────────

function _cacheDisponibile() {
  return typeof caches !== "undefined" && caches && typeof caches.open === "function";
}

async function _copiaSalva(record) {
  if (!_cacheDisponibile()) { annota(record.client_id, "copia_fallita", "Cache API assente"); return false; }
  try {
    const c = await caches.open(COPIA_CACHE);
    await c.put(new Request(COPIA_PREFIX + record.client_id),
                new Response(JSON.stringify(record), { headers: { "Content-Type": "application/json" } }));
    return true;
  } catch (e) {
    annota(record.client_id, "copia_fallita", String(e.message || e));
    return false;
  }
}

async function _copiaRimuovi(client_id) {
  if (!_cacheDisponibile()) return;
  try {
    const c = await caches.open(COPIA_CACHE);
    await c.delete(new Request(COPIA_PREFIX + client_id));
  } catch { /* la copia orfana la toglie la riconciliazione */ }
}

/** Tutte le copie: [{client_id, record}]. */
async function _copieTutte() {
  if (!_cacheDisponibile()) return [];
  try {
    const c = await caches.open(COPIA_CACHE);
    const chiavi = await c.keys();
    const out = [];
    for (const k of chiavi) {
      const id = k.url.slice(k.url.indexOf(COPIA_PREFIX) + COPIA_PREFIX.length);
      if (!id) continue;
      const r = await c.match(k);
      if (!r) continue;
      try { out.push({ client_id: id, record: await r.json() }); } catch { out.push({ client_id: id, record: null }); }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * RICONCILIAZIONE coda ⇄ copia. Idempotente. Chiamata a ogni avvio e prima di
 * ogni svuotamento:
 *  - copia presente, coda no, diario senza «consegnato» → si RIMETTE in coda
 *    («ripristinato»: e' il caso del 22/09)
 *  - copia presente, diario dice «consegnato» → copia orfana, si toglie
 *  - copia illeggibile → «copia_illeggibile», si toglie: non si puo' ripristinare
 */
export async function riconcilia() {
  const copie = await _copieTutte();
  if (!copie.length) return 0;
  const consegnati = new Set(leggiDiario().filter((v) => v.ev === "consegnato").map((v) => v.id));
  let ripristinati = 0;
  for (const { client_id, record } of copie) {
    if (consegnati.has(client_id)) { await _copiaRimuovi(client_id); continue; }
    if (!record || record.client_id !== client_id) {
      annota(client_id, "copia_illeggibile");
      await _copiaRimuovi(client_id);
      continue;
    }
    let inCoda = null;
    try { inCoda = await _tx("readonly", (s) => s.get(client_id)); } catch { inCoda = null; }
    if (inCoda) continue;
    try {
      const rec = { ...record, tentativi: 0, prossimo_tentativo: 0, ultimo_errore: null };
      await _tx("readwrite", (s) => s.put(rec));
      annota(client_id, "ripristinato", { da: "copia", tentativi_prima: record.tentativi || 0 });
      ripristinati += 1;
    } catch (e) {
      annota(client_id, "ripristino_fallito", String(e.message || e));
    }
  }
  if (ripristinati) _notifica();
  return ripristinati;
}

// ── API pubblica: coda ───────────────────────────────────────────────────────

export function nuovoClientId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "d-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
}

function _kb(record) {
  let n = (record.audio || "").length + (record.testo || "").length;
  for (const f of record.foto || []) n += (f || "").length;
  for (const a of record.allegati || []) n += (a?.b64 || "").length;
  return Math.round(n / 1024);
}

/**
 * Mette un pacchetto in coda e tenta subito l'invio. Non attende il server.
 * Dal 23/09/2026: dopo la scrittura RILEGGE il record — se non c'e', lancia,
 * e «Deposita» lo dice; poi salva la copia e annota nel diario.
 */
export async function accoda(pacchetto) {
  const record = {
    client_id: pacchetto.client_id || nuovoClientId(),
    creato_dispositivo: pacchetto.creato_dispositivo || new Date().toISOString(),
    audio: pacchetto.audio || null,
    foto: pacchetto.foto || [],
    testo: pacchetto.testo || null,
    allegati: pacchetto.allegati || [],
    origine: "kirk-pwa",
    tentativi: 0,
    prossimo_tentativo: 0,
    ultimo_errore: null,
  };
  await _tx("readwrite", (s) => s.put(record));
  const riletto = await _tx("readonly", (s) => s.get(record.client_id));
  if (!riletto || riletto.client_id !== record.client_id) {
    annota(record.client_id, "accodamento_fallito", "scritto ma non rileggibile");
    throw new Error("la coda del telefono non ha conservato il pacchetto");
  }
  const copia = await _copiaSalva(record);
  annota(record.client_id, "accodato", {
    kb: _kb(record), foto: record.foto.length, voce: Boolean(record.audio),
    allegati: record.allegati.length, copia, online: navigator.onLine,
  });
  _notifica();
  svuota();               // tentativo immediato, senza attendere
  return record.client_id;
}

export async function inAttesa() {
  const tutti = await _tx("readonly", (s) => s.getAll());
  return tutti || [];
}

export async function quanti() {
  return (await inAttesa()).length;
}

/** Callback invocata a ogni cambio di stato della coda (per il contatore in UI). */
export function osserva(fn) {
  _onCambio = fn;
  _notifica();
}

async function _notifica() {
  if (_onCambio) {
    try { _onCambio(await quanti()); } catch { /* la UI non deve rompere la coda */ }
  }
}

/**
 * Tenta di consegnare tutto quello che e' in coda.
 * Idempotente e sicura da richiamare: se e' gia' in esecuzione, esce.
 */
export async function svuota() {
  if (_inCorso) return;
  if (!navigator.onLine) { _riprogramma(30000); return; }

  _inCorso = true;
  try {
    try { await riconcilia(); } catch { /* la coda parte lo stesso */ }
    const pacchetti = await inAttesa();
    const ora = Date.now();
    let daRiprovare = false;

    for (const p of pacchetti) {
      if (p.prossimo_tentativo && p.prossimo_tentativo > ora) { daRiprovare = true; continue; }
      try {
        const { inviaDeposito } = await import("./api.js");
        const risposta = await inviaDeposito({
          client_id: p.client_id,
          creato_dispositivo: p.creato_dispositivo,
          audio: p.audio,
          foto: p.foto,
          testo: p.testo,
          allegati: p.allegati || [],
          origine: p.origine,
        });
        // Consegnato: SOLO ORA esce dalla coda. Prima il diario, poi la coda, poi la copia:
        // se l'app muore in mezzo, la riconciliazione vede «consegnato» e toglie la copia.
        annota(p.client_id, "consegnato", {
          tentativi: (p.tentativi || 0) + 1,
          risposta: risposta && typeof risposta === "object"
            ? (risposta.id || risposta.cartella || risposta.status || "ok") : "ok",
        });
        await _tx("readwrite", (s) => s.delete(p.client_id));
        await _copiaRimuovi(p.client_id);
        _notifica();
      } catch (err) {
        p.tentativi = (p.tentativi || 0) + 1;
        p.ultimo_errore = String(err.message || err);
        const attesa = ATTESE_MS[Math.min(p.tentativi - 1, ATTESE_MS.length - 1)];
        p.prossimo_tentativo = Date.now() + attesa;
        annota(p.client_id, "tentativo", { n: p.tentativi, errore: p.ultimo_errore, online: navigator.onLine });
        try {
          await _tx("readwrite", (s) => s.put(p));
        } catch (e2) {
          annota(p.client_id, "aggiornamento_fallito", String(e2.message || e2));
        }
        daRiprovare = true;
        _notifica();
      }
    }

    if (daRiprovare) _riprogramma(_attesaMinima(await inAttesa()));
  } finally {
    _inCorso = false;
  }
}

function _attesaMinima(pacchetti) {
  if (!pacchetti.length) return 0;
  const ora = Date.now();
  const attese = pacchetti.map((p) => Math.max(1000, (p.prossimo_tentativo || 0) - ora));
  return Math.min(...attese, 300000);
}

function _riprogramma(ms) {
  if (!ms) return;
  clearTimeout(_timer);
  _timer = setTimeout(() => svuota(), ms);
}

/** Chiede al browser di non sfrattare questa origine. Annota solo quando l'esito cambia. */
async function _chiediPersistenza() {
  try {
    if (!navigator.storage || !navigator.storage.persist) {
      if (localStorage.getItem(PERSIST_KEY) !== "assente") {
        localStorage.setItem(PERSIST_KEY, "assente");
        annota("-", "persistenza", "API assente");
      }
      return;
    }
    const gia = await navigator.storage.persisted();
    const ok = gia || await navigator.storage.persist();
    const esito = ok ? "concessa" : "negata";
    if (localStorage.getItem(PERSIST_KEY) !== esito) {
      localStorage.setItem(PERSIST_KEY, esito);
      annota("-", "persistenza", esito);
    }
  } catch (e) {
    annota("-", "persistenza", "errore: " + String(e.message || e));
  }
}

/** Aggancia i risvegli automatici: rete che torna, app che torna in primo piano. */
export function avviaSorveglianza() {
  window.addEventListener("online", () => svuota());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") svuota();
  });
  _chiediPersistenza();
  svuota();
}

// ── API pubblica: bozza ──────────────────────────────────────────────────────

/**
 * Salva la bozza corrente (sostituisce la precedente). I pezzi audio sono
 * Blob: IndexedDB li conserva cosi' come sono, senza passare da base64.
 */
export function salvaBozza(bozza) {
  return _tx("readwrite", (s) => s.put({ ...bozza, id: BOZZA_ID, aggiornato: Date.now() }),
             STORE_BOZZA);
}

export async function leggiBozza() {
  try {
    return (await _tx("readonly", (s) => s.get(BOZZA_ID), STORE_BOZZA)) || null;
  } catch {
    return null;
  }
}

export function svuotaBozza() {
  return _tx("readwrite", (s) => s.delete(BOZZA_ID), STORE_BOZZA).catch(() => {});
}

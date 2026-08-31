/**
 * Coda offline dei depositi.
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
 */

const DB_NAME = "kirk-deposito";
const DB_VERSION = 1;
const STORE = "coda";

const ATTESE_MS = [5000, 15000, 60000, 300000, 900000]; // 5s, 15s, 1m, 5m, 15m

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
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function _tx(modo, fn) {
  return _apri().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, modo);
    const store = tx.objectStore(STORE);
    const req = fn(store);
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  }));
}

// ── API pubblica ─────────────────────────────────────────────────────────────

export function nuovoClientId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "d-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
}

/** Mette un pacchetto in coda e tenta subito l'invio. Non attende il server. */
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
    const pacchetti = await inAttesa();
    const ora = Date.now();
    let daRiprovare = false;

    for (const p of pacchetti) {
      if (p.prossimo_tentativo && p.prossimo_tentativo > ora) { daRiprovare = true; continue; }
      try {
        const { inviaDeposito } = await import("./api.js");
        await inviaDeposito({
          client_id: p.client_id,
          creato_dispositivo: p.creato_dispositivo,
          audio: p.audio,
          foto: p.foto,
          testo: p.testo,
          allegati: p.allegati || [],
          origine: p.origine,
        });
        // Consegnato: SOLO ORA esce dalla coda
        await _tx("readwrite", (s) => s.delete(p.client_id));
        _notifica();
      } catch (err) {
        p.tentativi = (p.tentativi || 0) + 1;
        p.ultimo_errore = String(err.message || err);
        const attesa = ATTESE_MS[Math.min(p.tentativi - 1, ATTESE_MS.length - 1)];
        p.prossimo_tentativo = Date.now() + attesa;
        await _tx("readwrite", (s) => s.put(p));
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

/** Aggancia i risvegli automatici: rete che torna, app che torna in primo piano. */
export function avviaSorveglianza() {
  window.addEventListener("online", () => svuota());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") svuota();
  });
  svuota();
}

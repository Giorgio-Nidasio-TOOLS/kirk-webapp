/**
 * Il Deposito: foto (0..n) + voce + testo in un pacchetto solo.
 *
 * L'unita' di cattura NON e' il biglietto da visita: e' l'incontro.
 * A volte c'e' un cartoncino, a volte un pezzo di carta, a volte solo la voce
 * o un link dettato, a volte una richiesta di lavoro per il PC. Per questo
 * tutto e' facoltativo, tranne che almeno una delle tre cose ci sia.
 * Documento o richiesta: e' la stessa cosa. Ogni pacchetto porta l'ora del
 * telefono; distinguere cosa contiene e' lavoro del PC che lo legge.
 *
 * Foto e voce entrano INSIEME perche' e' la voce a disambiguare la foto: un
 * biglietto puo' contenere due persone (una stampata, una scritta a penna) e
 * non dice quale sia l'interlocutore. Nessun OCR puo' saperlo.
 *
 * Questa schermata contiene L'UNICO MICROFONO dell'app. Prima ce n'erano due,
 * identici e in punti diversi, con destini opposti: uno conservava, l'altro
 * poteva bruciare il lavoro.
 *
 * Dal 30/08/2026 il Deposito non e' piu' un pannello da aprire: e' la
 * schermata stessa. Sotto al modulo c'e' il REGISTRO degli ultimi depositi.
 *
 * Dall'11/09/2026 (un deposito dato per consegnato non era mai arrivato):
 *  - LA BOZZA VIVE SU DISCO: testo, foto, allegati e i pezzi della voce
 *    finiscono in IndexedDB man mano che nascono; alla riapertura si ritrova
 *    tutto e si puo' depositare. Si cancella solo quando il pacchetto e' in coda.
 *  - «Deposita» ferma da solo una registrazione in corso, non la rifiuta.
 *  - GLI ERRORI SONO GRANDI e restano finche' non si fa qualcos'altro.
 *  - IL REGISTRO SI FA CONFERMARE DAL PC: «✓ sul PC» lo dice il server, che
 *    ha il file. «⚠️ il PC non lo ha» e' la riga che l'11/09 sarebbe servita.
 */

import {
  accoda, nuovoClientId, quanti, inAttesa, osserva, avviaSorveglianza,
  salvaBozza, leggiBozza, svuotaBozza,
} from "./coda.js";
import { startRecording, stopRecording, isRecording, blobToBase64 } from "./audio.js";
import { verificaDepositi } from "./api.js";

const MAX_FOTO = 10;
const LATO_MAX = 1600;      // px: oltre non serve per leggere un biglietto
const QUALITA_JPEG = 0.82;

const MAX_ALLEGATI = 5;
// 50 MB per allegato: decisione di Giorgio (31/08/2026) — con rete lenta il
// pacchetto pesante resta in coda piu' a lungo, ma deve POTER partire.
const MAX_ALLEGATO_MB = 50;

const REGISTRO_KEY = "kirk_registro_depositi";
const REGISTRO_MAX = 20;
const VERIFICA_KEY = "kirk_registro_verifica";   // ultima risposta del PC sul registro

let _foto = [];             // [{b64}]
let _allegati = [];         // [{nome, mime, b64, dim}]
let _audioChunks = [];      // [Blob] pezzi della registrazione in corso (gia' su disco)
let _audioBlob = null;      // Blob della registrazione finita
let _durataAudio = 0;
let _tRegistrazione = 0;
let _bozzaRecuperata = false;
let _timerBozza = null;
let _verificaInCorso = false;
let _el = {};

// ── avvio ────────────────────────────────────────────────────────────────────

export function inizializzaDeposito() {
  _el = {
    fotoInput: document.getElementById("dep-foto-input"),
    fotoBtn:   document.getElementById("dep-foto-btn"),
    galleria:  document.getElementById("dep-galleria"),
    micBtn:    document.getElementById("dep-mic-btn"),
    audioInfo: document.getElementById("dep-audio-info"),
    testo:     document.getElementById("dep-testo"),
    imgInput:  document.getElementById("dep-img-input"),
    imgBtn:    document.getElementById("dep-immagini-btn"),
    fileInput: document.getElementById("dep-file-input"),
    allegaBtn: document.getElementById("dep-allega-btn"),
    allegati:  document.getElementById("dep-allegati"),
    inviaBtn:  document.getElementById("dep-invia-btn"),
    stato:     document.getElementById("dep-stato"),
    bozza:     document.getElementById("dep-bozza"),
    bozzaMsg:  document.getElementById("dep-bozza-msg"),
    bozzaScarta: document.getElementById("dep-bozza-scarta"),
    contatore: document.getElementById("dep-contatore"),
    lista:     document.getElementById("dep-lista"),
    vuota:     document.getElementById("dep-lista-vuota"),
  };
  if (!_el.inviaBtn) return;

  _el.fotoBtn.addEventListener("click", () => _el.fotoInput.click());
  _el.fotoInput.addEventListener("change", _aggiungiFoto);
  _el.micBtn.addEventListener("click", _toggleMic);
  _el.imgBtn.addEventListener("click", () => _el.imgInput.click());
  _el.imgInput.addEventListener("change", _aggiungiAllegati);
  _el.allegaBtn.addEventListener("click", () => _el.fileInput.click());
  _el.fileInput.addEventListener("change", _aggiungiAllegati);
  _el.inviaBtn.addEventListener("click", _invia);
  _el.testo.addEventListener("input", () => _persisti());
  if (_el.bozzaScarta) _el.bozzaScarta.addEventListener("click", _scartaBozza);

  // Ogni cambio della coda ridisegna contatore e registro: e' la coda la verita'
  // per cio' che non e' ancora partito; per cio' che e' partito, la verita' e' il PC.
  osserva((n) => { _mostraContatore(n); _disegnaRegistro(); if (n === 0) _verificaRegistro(); });
  avviaSorveglianza();

  // Il PC e' raggiungibile (app.js lo ha appena verificato): si fa confermare il registro.
  window.addEventListener("kirk:collegato", () => _verificaRegistro());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") _verificaRegistro();
  });

  _ripristinaBozza();
}

// ── bozza su disco ───────────────────────────────────────────────────────────

/** Salva la bozza corrente. Debounce breve: il testo cambia a ogni tasto. */
function _persisti(subito = false) {
  clearTimeout(_timerBozza);
  const scrivi = async () => {
    const testo = (_el.testo.value || "").trim();
    const vuota = !_foto.length && !_allegati.length && !testo
                  && !_audioBlob && !_audioChunks.length;
    try {
      if (vuota) { await svuotaBozza(); return; }
      await salvaBozza({
        testo,
        foto: _foto.map((f) => f.b64),
        allegati: _allegati.map((a) => ({ nome: a.nome, mime: a.mime, b64: a.b64, dim: a.dim })),
        audioChunks: _audioBlob ? [_audioBlob] : _audioChunks.slice(),
        durataAudio: _durataAudio,
        tRegistrazione: _tRegistrazione,
        registrazioneInCorso: isRecording(),
      });
    } catch (e) {
      // La bozza e' una rete, non un cancello: un errore di scrittura non blocca il lavoro.
      console.warn("bozza non salvata:", e);
    }
  };
  if (subito) return scrivi();
  _timerBozza = setTimeout(scrivi, 300);
}

async function _ripristinaBozza() {
  const b = await leggiBozza();
  if (!b) return;
  const chunks = (b.audioChunks || []).filter((c) => c && c.size > 0);
  const haQualcosa = (b.foto || []).length || (b.allegati || []).length
                     || (b.testo || "").trim() || chunks.length;
  if (!haQualcosa) { svuotaBozza(); return; }

  _foto = (b.foto || []).map((b64) => ({ b64 }));
  _allegati = (b.allegati || []).slice();
  _el.testo.value = b.testo || "";
  if (chunks.length) {
    _audioBlob = new Blob(chunks, { type: "audio/webm" });
    _audioChunks = [];
    // Durata: quella misurata se c'e', altrimenti 3 s per pezzo (il timeslice del registratore).
    _durataAudio = b.durataAudio || (b.registrazioneInCorso ? chunks.length * 3 : 0);
    const nota = b.registrazioneInCorso ? " — la registrazione era stata interrotta" : "";
    _el.audioInfo.textContent = `🔊 voce recuperata${_durataAudio ? ` (${_durataAudio}s)` : ""}${nota} — tocca 🎤 per rifare`;
  }
  _disegnaGalleria();
  _disegnaAllegati();

  const parti = [];
  if (_foto.length) parti.push(_foto.length === 1 ? "1 foto" : `${_foto.length} foto`);
  if (chunks.length) parti.push("voce");
  if ((b.testo || "").trim()) parti.push("testo");
  if (_allegati.length) parti.push(`${_allegati.length} allegat${_allegati.length === 1 ? "o" : "i"}`);
  _bozzaRecuperata = true;
  _mostraBozza(`📌 Bozza recuperata (${parti.join(", ")}): non era stata depositata. Controlla e premi Deposita.`);
}

function _mostraBozza(msg) {
  if (!_el.bozza) return;
  _el.bozzaMsg.textContent = msg;
  _el.bozza.classList.remove("hidden");
}

function _nascondiBozza() {
  _bozzaRecuperata = false;
  if (_el.bozza) _el.bozza.classList.add("hidden");
}

async function _scartaBozza() {
  if (!confirm("Scartare la bozza recuperata? Foto, voce e testo andranno persi.")) return;
  await svuotaBozza();
  _reset();
  _nascondiBozza();
  _statoTemporaneo("Bozza scartata", "", 2500);
}

// ── foto ─────────────────────────────────────────────────────────────────────

async function _aggiungiFoto(ev) {
  const files = [...(ev.target.files || [])];
  ev.target.value = "";                      // permette di riscattare la stessa foto
  for (const f of files) {
    if (_foto.length >= MAX_FOTO) {
      _stato(`Massimo ${MAX_FOTO} foto per deposito`, "err");
      break;
    }
    try {
      const b64 = await _ridimensiona(f);
      _foto.push({ b64 });
      _disegnaGalleria();
      _persisti(true);
    } catch (e) {
      _stato("Foto non leggibile: " + e.message, "err");
    }
  }
}

/**
 * Ridimensiona a lato massimo 1600 px e ricomprime in JPEG.
 * Una foto da telefono e' 4-8 MB: trenta di quelle non partono mai da una
 * fiera con la rete satura. A 1600 px un biglietto resta perfettamente leggibile.
 */
function _ridimensiona(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      const scala = Math.min(1, LATO_MAX / Math.max(w, h));
      w = Math.round(w * scala);
      h = Math.round(h * scala);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", QUALITA_JPEG);
      resolve(dataUrl.split(",")[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("formato non supportato")); };
    img.src = url;
  });
}

function _disegnaGalleria() {
  _el.galleria.innerHTML = "";
  _foto.forEach((f, i) => {
    const div = document.createElement("div");
    div.className = "dep-thumb";
    const img = document.createElement("img");
    img.src = "data:image/jpeg;base64," + f.b64;
    const x = document.createElement("button");
    x.className = "dep-thumb-x";
    x.textContent = "×";
    x.title = "Togli questa foto";
    x.addEventListener("click", () => { _foto.splice(i, 1); _disegnaGalleria(); _persisti(true); });
    div.append(img, x);
    _el.galleria.appendChild(div);
  });
  _el.fotoBtn.textContent = _foto.length ? `📷 Aggiungi (${_foto.length})` : "📷 Foto";
}

// ── allegati ─────────────────────────────────────────────────────────────────
// Due selettori PULITI (dal 01/09/2026): 🖼 apre il selettore immagini di
// Android (galleria, anche cloud) e cio' che arriva diventa FOTO; 📎 apre il
// selettore file (Recenti, Download, OneDrive) e cio' che arriva viaggia
// com'e'. Un solo input senza `accept` faceva comparire lo "Scegli un'azione"
// di Samsung, con le fotocamere e un ambiguo "Foto e video".
// Lo stesso handler serve entrambi: decide dal TIPO del file, non dal pulsante.

async function _aggiungiAllegati(ev) {
  const files = [...(ev.target.files || [])];
  ev.target.value = "";
  for (const f of files) {
    if (f.type && f.type.startsWith("image/")) {
      if (_foto.length >= MAX_FOTO) { _stato(`Massimo ${MAX_FOTO} foto per deposito`, "err"); continue; }
      try {
        const b64 = await _ridimensiona(f);
        _foto.push({ b64 });
        _disegnaGalleria();
        _persisti(true);
        continue;
      } catch {
        // Formato che il canvas non decodifica (es. HEIC): non si perde niente,
        // il file scende nel ramo allegati e viaggia com'e'.
      }
    }
    if (_allegati.length >= MAX_ALLEGATI) {
      _stato(`Massimo ${MAX_ALLEGATI} allegati per deposito`, "err");
      break;
    }
    if (f.size > MAX_ALLEGATO_MB * 1024 * 1024) {
      _stato(`"${f.name}" supera i ${MAX_ALLEGATO_MB} MB`, "err");
      continue;
    }
    try {
      const b64 = await _leggiFileB64(f);
      _allegati.push({ nome: f.name, mime: f.type || "", b64, dim: f.size });
      _disegnaAllegati();
      _persisti(true);
    } catch (e) {
      _stato(`"${f.name}" non leggibile: ` + e.message, "err");
    }
  }
}

function _leggiFileB64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("lettura fallita"));
    reader.readAsDataURL(file);
  });
}

function _mb(byte) {
  return byte >= 1048576 ? (byte / 1048576).toFixed(1) + " MB"
                         : Math.max(1, Math.round(byte / 1024)) + " KB";
}

function _disegnaAllegati() {
  _el.allegati.innerHTML = "";
  _allegati.forEach((a, i) => {
    const chip = document.createElement("div");
    chip.className = "dep-chip";
    const nome = document.createElement("span");
    nome.className = "dep-chip-nome";
    nome.textContent = `📎 ${a.nome}`;
    const dim = document.createElement("span");
    dim.className = "dep-chip-dim";
    dim.textContent = _mb(a.dim);
    const x = document.createElement("button");
    x.className = "dep-chip-x";
    x.textContent = "×";
    x.title = "Togli questo allegato";
    x.addEventListener("click", () => { _allegati.splice(i, 1); _disegnaAllegati(); _persisti(true); });
    chip.append(nome, dim, x);
    _el.allegati.appendChild(chip);
  });
  _el.allegaBtn.textContent = _allegati.length
    ? `📎 Documenti (${_allegati.length})` : "📎 Documenti";
}

// ── voce ─────────────────────────────────────────────────────────────────────

function _micIdle() {
  _el.micBtn.textContent = "🎤 Registra";
  _el.micBtn.classList.remove("recording");
}

/** La registrazione e' finita (per mano di Giorgio o del sistema): si conserva. */
function _registrazioneFinita(esito) {
  _audioBlob = esito.blob && esito.blob.size > 0 ? esito.blob : null;
  _audioChunks = [];
  _durataAudio = _tRegistrazione ? Math.round((Date.now() - _tRegistrazione) / 1000) : 0;
  _micIdle();
  if (!_audioBlob) {
    _el.audioInfo.textContent = "";
    _stato("Registrazione vuota: il microfono non ha dato nulla" + (esito.motivo ? ` (${esito.motivo})` : ""), "err");
  } else if (esito.spontaneo) {
    _el.audioInfo.textContent = `🔊 registrati ${_durataAudio}s — interrotti dal sistema, ma salvati — tocca 🎤 per rifare`;
    _stato(`⚠️ La registrazione si è fermata da sola${esito.motivo ? ` (${esito.motivo})` : ""}: ${_durataAudio}s salvati. Controlla e premi Deposita.`, "err");
  } else {
    _el.audioInfo.textContent = `🔊 registrati ${_durataAudio}s — tocca 🎤 per rifare`;
    _stato("", "");
  }
  _persisti(true);
}

async function _toggleMic() {
  if (isRecording()) {
    _stato("Sto chiudendo la registrazione…", "");
    const esito = await stopRecording();
    _registrazioneFinita(esito);
    return;
  }
  try {
    await startRecording({
      // Ogni pezzo va su disco appena nasce: cio' che e' detto e' gia' salvato.
      onChunk: (chunk) => { _audioChunks.push(chunk); _persisti(true); },
      // Il sistema ha fermato il registratore senza passare da «Ferma».
      onFine: (esito) => _registrazioneFinita(esito),
    });
    _audioBlob = null;
    _audioChunks = [];
    _tRegistrazione = Date.now();
    _durataAudio = 0;
    _el.micBtn.textContent = "⏹ Ferma";
    _el.micBtn.classList.add("recording");
    _el.audioInfo.textContent = "";
    _stato("Sto registrando…", "");
    _persisti(true);
  } catch {
    _stato("Microfono non disponibile — controlla i permessi", "err");
  }
}

// ── invio ────────────────────────────────────────────────────────────────────

async function _invia() {
  // Registrazione ancora aperta: si chiude qui, non si rifiuta il deposito.
  if (isRecording()) {
    _stato("Chiudo la registrazione e deposito…", "");
    _registrazioneFinita(await stopRecording());
  }

  const testo = (_el.testo.value || "").trim();
  if (!_foto.length && !_audioBlob && !testo && !_allegati.length) {
    _stato("⚠️ Niente da depositare: serve almeno una foto, la voce, del testo o un allegato", "err");
    return;
  }

  _el.inviaBtn.disabled = true;
  try {
    let audioB64 = null;
    if (_audioBlob) {
      try {
        audioB64 = await blobToBase64(_audioBlob);
      } catch (e) {
        _stato("⚠️ Non riesco a leggere l'audio registrato: " + e.message, "err");
        return;
      }
    }

    const client_id = nuovoClientId();
    const creato = new Date().toISOString();
    const pesoAllegati = _allegati.reduce((s, a) => s + (a.dim || 0), 0);

    // Il registro si scrive PRIMA di accodare: se anche l'app morisse qui,
    // meglio una riga in piu' nel registro che un deposito senza traccia.
    _registraDeposito({
      client_id,
      creato,
      n_foto: _foto.length,
      durata_audio: audioB64 ? _durataAudio : 0,
      ha_testo: Boolean(testo),
      n_allegati: _allegati.length,
    });

    // Il pacchetto va in coda e il modulo si svuota SUBITO: non si aspetta il server.
    await accoda({
      client_id,
      creato_dispositivo: creato,
      audio: audioB64,
      foto: _foto.map((f) => f.b64),
      testo: testo || null,
      allegati: _allegati.map((a) => ({ nome: a.nome, mime: a.mime, b64: a.b64 })),
    });

    // SOLO ORA la bozza puo' sparire: il pacchetto e' in coda, su disco.
    clearTimeout(_timerBozza);
    await svuotaBozza();
    _reset();
    _nascondiBozza();
    _disegnaRegistro();
    // Un pacchetto pesante non e' un errore, ma con rete lenta ci vorra' pazienza:
    // meglio dirlo subito che lasciar dubitare del contatore fermo.
    if (pesoAllegati > 25 * 1048576) {
      _statoTemporaneo(`✓ In coda — pacchetto pesante (${_mb(pesoAllegati)}): con rete lenta servirà pazienza`, "ok", 6000);
    } else {
      _statoTemporaneo("✓ In coda — parte da sola appena c'è rete", "ok", 2500);
    }
  } catch (e) {
    // La bozza e' ancora su disco: niente e' perso, si puo' ripremere Deposita.
    _stato("⚠️ Deposito non riuscito: " + (e.message || e) + " — la bozza è salva, riprova", "err");
  } finally {
    _el.inviaBtn.disabled = false;
  }
}

function _reset() {
  _foto = [];
  _allegati = [];
  _audioBlob = null;
  _audioChunks = [];
  _durataAudio = 0;
  _tRegistrazione = 0;
  _el.testo.value = "";
  _el.audioInfo.textContent = "";
  _micIdle();
  _disegnaGalleria();
  _disegnaAllegati();
}

// ── registro degli ultimi depositi ───────────────────────────────────────────

function _leggiRegistro() {
  try {
    const raw = localStorage.getItem(REGISTRO_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function _registraDeposito(voce) {
  const reg = [voce, ..._leggiRegistro()].slice(0, REGISTRO_MAX);
  try { localStorage.setItem(REGISTRO_KEY, JSON.stringify(reg)); } catch { /* quota: pazienza */ }
}

function _leggiVerifica() {
  try {
    const v = JSON.parse(localStorage.getItem(VERIFICA_KEY) || "null");
    return v && Array.isArray(v.presenti)
      ? { rinunciati: [], ...v }        // le verifiche vecchie non hanno il terzo stato
      : { presenti: [], mancanti: [], rinunciati: [], ts: 0 };
  } catch {
    return { presenti: [], mancanti: [], rinunciati: [], ts: 0 };
  }
}

/**
 * Chiede al PC quali depositi del registro ha davvero. Silenziosa: se il PC
 * non risponde, le righe restano com'erano. Manda anche quanti pacchetti sono
 * in coda e se c'e' una bozza, per la sentinella del Tool 04.
 */
async function _verificaRegistro() {
  if (_verificaInCorso || !navigator.onLine) return;
  const righe = _leggiRegistro();
  if (!righe.length) return;
  _verificaInCorso = true;
  try {
    const inCoda = await inAttesa();
    const pendenti = new Set(inCoda.map((p) => p.client_id));
    const daVerificare = righe.map((r) => r.client_id).filter((id) => id && !pendenti.has(id));
    const bozza = Boolean(await leggiBozza());
    const esito = await verificaDepositi(daVerificare, inCoda.length, bozza);
    const prec = _leggiVerifica();
    // Un deposito confermato una volta resta confermato: il PC puo' archiviare le fonti.
    const presenti = [...new Set([...(prec.presenti || []), ...(esito.presenti || [])])];
    // ⭐ Terzo stato, dal 16/09/2026: il PC puo' dire «questo l'ho DATO PER PERSO, ecco perche'».
    //    Non e' un «consegnato» (sarebbe una bugia) e non e' piu' un allarme: e' una perdita
    //    gia' guardata e messa a verbale. Senza questo stato la riga resta rossa per sempre e
    //    l'avviso perde significato — un semaforo sempre acceso e' un semaforo spento.
    const rinunciati = (esito.rinunciati || []).filter((r) => r && r.client_id);
    const idRinunciati = new Set(rinunciati.map((r) => r.client_id));
    const mancanti = (esito.mancanti || [])
      .filter((id) => !presenti.includes(id) && !idRinunciati.has(id));
    try {
      localStorage.setItem(VERIFICA_KEY,
        JSON.stringify({ ts: Date.now(), presenti, mancanti, rinunciati }));
    } catch { /* quota */ }
    _disegnaRegistro();
  } catch {
    // PC non raggiungibile o token sbagliato: lo dice la barra di stato, non il registro.
  } finally {
    _verificaInCorso = false;
  }
}

/**
 * L'esito di ogni riga si DERIVA, non si dichiara:
 *  - client_id ancora in coda        → ⏳ in coda (col numero di tentativi, se ha gia' fallito)
 *  - il PC ha detto di averlo        → ✓ sul PC
 *  - il PC ha detto di NON averlo    → ⚠️ il PC non lo ha
 *  - non piu' in coda, PC non ancora sentito → ✓ consegnato (da confermare)
 * Un pacchetto in coda senza riga nel registro (non dovrebbe accadere) si mostra lo stesso.
 */
async function _disegnaRegistro() {
  if (!_el.lista) return;
  let inCoda = [];
  try { inCoda = await inAttesa(); } catch { inCoda = []; }
  const pendenti = new Map(inCoda.map((p) => [p.client_id, p]));
  const verifica = _leggiVerifica();
  const sulPC = new Set(verifica.presenti || []);
  const mancanti = new Set(verifica.mancanti || []);
  const rinunciati = new Map((verifica.rinunciati || []).map((r) => [r.client_id, r]));

  const righe = _leggiRegistro();
  const noti = new Set(righe.map((r) => r.client_id));
  for (const p of inCoda) {
    if (!noti.has(p.client_id)) {
      righe.push({
        client_id: p.client_id,
        creato: p.creato_dispositivo,
        n_foto: (p.foto || []).length,
        durata_audio: p.audio ? -1 : 0,
        ha_testo: Boolean(p.testo),
        n_allegati: (p.allegati || []).length,
      });
    }
  }
  righe.sort((a, b) => String(b.creato).localeCompare(String(a.creato)));

  _el.lista.innerHTML = "";
  _el.vuota.classList.toggle("hidden", righe.length > 0);

  for (const r of righe) {
    const p = pendenti.get(r.client_id);
    const li = document.createElement("li");

    const ora = document.createElement("span");
    ora.className = "reg-ora";
    ora.textContent = _formattaOra(r.creato);

    const cosa = document.createElement("span");
    cosa.className = "reg-cosa";
    cosa.textContent = _descrivi(r);

    const esito = document.createElement("span");
    esito.className = "reg-esito";
    if (p) {
      li.className = "in-coda";
      const tentativi = p.tentativi || 0;
      esito.textContent = tentativi ? `⏳ in coda · ${tentativi} tentativ${tentativi === 1 ? "o" : "i"}` : "⏳ in coda";
      if (p.ultimo_errore) esito.title = p.ultimo_errore;
    } else if (mancanti.has(r.client_id)) {
      li.className = "mancante";
      esito.textContent = "⚠️ il PC non lo ha";
      esito.title = "Il PC non ha mai ricevuto questo deposito. Se puoi, rifallo.";
    } else if (rinunciati.has(r.client_id)) {
      const v = rinunciati.get(r.client_id);
      li.className = "rinunciato";
      esito.textContent = "✕ perso, chiuso";
      esito.title = `Dato per perso il ${v.data || "?"}: ${v.motivo || "senza motivo"}`
        + (v.rimedio ? `\nAl suo posto: ${v.rimedio}` : "");
    } else if (sulPC.has(r.client_id)) {
      li.className = "sul-pc";
      esito.textContent = "✓ sul PC";
      esito.title = "Confermato dal PC: il pacchetto è sul disco";
    } else {
      li.className = "consegnato";
      esito.textContent = "✓ consegnato";
      esito.title = "Uscito dalla coda; il PC non ha ancora confermato";
    }

    li.append(ora, cosa, esito);
    _el.lista.appendChild(li);
  }
}

function _descrivi(r) {
  const parti = [];
  if (r.n_foto) parti.push(r.n_foto === 1 ? "1 foto" : `${r.n_foto} foto`);
  if (r.durata_audio > 0) parti.push(`voce ${r.durata_audio}s`);
  else if (r.durata_audio < 0) parti.push("voce");
  if (r.ha_testo) parti.push("testo");
  if (r.n_allegati) parti.push(r.n_allegati === 1 ? "1 allegato" : `${r.n_allegati} allegati`);
  return parti.join(" · ") || "—";
}

function _formattaOra(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  const oggi = new Date();
  const stessoGiorno = d.toDateString() === oggi.toDateString();
  const hm = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  if (stessoGiorno) return hm;
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) + " " + hm;
}

// ── stato e contatore ────────────────────────────────────────────────────────

/** Gli errori restano finche' non succede qualcos'altro: un errore che sparisce
 *  da solo e' un errore che nessuno legge (11/09/2026). */
let _statoSeq = 0;
function _stato(testo, cls) {
  if (!_el.stato) return;
  _statoSeq += 1;
  _el.stato.textContent = testo;
  _el.stato.className = cls || "";
}

/** Un messaggio che sparisce da solo — ma SOLO se nel frattempo non ne e' arrivato
 *  un altro: prima, il timer del «✓ In coda» cancellava l'errore comparso subito dopo. */
function _statoTemporaneo(testo, cls, ms) {
  _stato(testo, cls);
  const mio = _statoSeq;
  setTimeout(() => { if (_statoSeq === mio) _stato("", ""); }, ms);
}

/**
 * Il contatore e' sempre visibile quando c'e' qualcosa in coda (sta nell'header).
 * Se un deposito non e' ancora arrivato al PC, Giorgio lo deve vedere:
 * il fallimento silenzioso e' l'unico che fa perdere fiducia nel canale.
 */
function _mostraContatore(n) {
  if (!_el.contatore) return;
  if (n > 0) {
    _el.contatore.textContent = n === 1 ? "1 da inviare" : `${n} da inviare`;
    _el.contatore.classList.remove("hidden");
  } else {
    _el.contatore.classList.add("hidden");
  }
}

export { quanti as depositiInAttesa };

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
 * schermata stessa. Sotto al modulo c'e' il REGISTRO degli ultimi depositi,
 * con l'esito DERIVATO dalla coda (coda.js), mai dichiarato: se il client_id
 * e' ancora in coda non e' arrivato; se non c'e' piu', il server ha risposto 200.
 */

import { accoda, nuovoClientId, quanti, inAttesa, osserva, avviaSorveglianza } from "./coda.js";
import { startRecording, stopRecording, isRecording } from "./audio.js";

const MAX_FOTO = 10;
const LATO_MAX = 1600;      // px: oltre non serve per leggere un biglietto
const QUALITA_JPEG = 0.82;

const REGISTRO_KEY = "kirk_registro_depositi";
const REGISTRO_MAX = 20;

let _foto = [];             // [{b64}]
let _audioB64 = null;
let _durataAudio = 0;
let _tRegistrazione = 0;
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
    inviaBtn:  document.getElementById("dep-invia-btn"),
    stato:     document.getElementById("dep-stato"),
    contatore: document.getElementById("dep-contatore"),
    lista:     document.getElementById("dep-lista"),
    vuota:     document.getElementById("dep-lista-vuota"),
  };
  if (!_el.inviaBtn) return;

  _el.fotoBtn.addEventListener("click", () => _el.fotoInput.click());
  _el.fotoInput.addEventListener("change", _aggiungiFoto);
  _el.micBtn.addEventListener("click", _toggleMic);
  _el.inviaBtn.addEventListener("click", _invia);

  // Ogni cambio della coda ridisegna contatore e registro: e' la coda la verita'.
  osserva((n) => { _mostraContatore(n); _disegnaRegistro(); });
  avviaSorveglianza();
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
    x.addEventListener("click", () => { _foto.splice(i, 1); _disegnaGalleria(); });
    div.append(img, x);
    _el.galleria.appendChild(div);
  });
  _el.fotoBtn.textContent = _foto.length ? `📷 Aggiungi (${_foto.length})` : "📷 Foto";
}

// ── voce ─────────────────────────────────────────────────────────────────────

async function _toggleMic() {
  if (isRecording()) {
    _el.micBtn.textContent = "🎤 Registra";
    _el.micBtn.classList.remove("recording");
    try {
      _audioB64 = await stopRecording();
      _durataAudio = Math.round((Date.now() - _tRegistrazione) / 1000);
      _el.audioInfo.textContent = `🔊 registrati ${_durataAudio}s — tocca 🎤 per rifare`;
      _stato("", "");
    } catch (e) {
      _stato("Registrazione non riuscita: " + e.message, "err");
    }
    return;
  }
  try {
    await startRecording();
    _tRegistrazione = Date.now();
    _el.micBtn.textContent = "⏹ Ferma";
    _el.micBtn.classList.add("recording");
    _stato("Sto registrando…", "");
  } catch {
    _stato("Microfono non disponibile — controlla i permessi", "err");
  }
}

// ── invio ────────────────────────────────────────────────────────────────────

async function _invia() {
  if (isRecording()) { _stato("Ferma prima la registrazione", "err"); return; }

  const testo = (_el.testo.value || "").trim();
  if (!_foto.length && !_audioB64 && !testo) {
    _stato("Serve almeno una foto, la voce o del testo", "err");
    return;
  }

  const client_id = nuovoClientId();
  const creato = new Date().toISOString();

  // Il registro si scrive PRIMA di accodare: se anche l'app morisse qui,
  // meglio una riga in piu' nel registro che un deposito senza traccia.
  _registraDeposito({
    client_id,
    creato,
    n_foto: _foto.length,
    durata_audio: _audioB64 ? _durataAudio : 0,
    ha_testo: Boolean(testo),
  });

  // Il pacchetto va in coda e il modulo si svuota SUBITO: non si aspetta il server.
  await accoda({
    client_id,
    creato_dispositivo: creato,
    audio: _audioB64,
    foto: _foto.map((f) => f.b64),
    testo: testo || null,
  });

  _reset();
  _disegnaRegistro();
  _stato("✓ In coda — parte da sola appena c'è rete", "ok");
  setTimeout(() => _stato("", ""), 2500);
}

function _reset() {
  _foto = [];
  _audioB64 = null;
  _durataAudio = 0;
  _el.testo.value = "";
  _el.audioInfo.textContent = "";
  _el.micBtn.textContent = "🎤 Registra";
  _disegnaGalleria();
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

/**
 * L'esito di ogni riga si DERIVA dalla coda, non si dichiara:
 *  - client_id ancora in coda  → ⏳ in attesa (col numero di tentativi, se ha gia' fallito)
 *  - client_id non piu' in coda → ✓ consegnato (il server ha risposto 200)
 * Un pacchetto in coda senza riga nel registro (non dovrebbe accadere) si mostra lo stesso.
 */
async function _disegnaRegistro() {
  if (!_el.lista) return;
  let inCoda = [];
  try { inCoda = await inAttesa(); } catch { inCoda = []; }
  const pendenti = new Map(inCoda.map((p) => [p.client_id, p]));

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
      });
    }
  }
  righe.sort((a, b) => String(b.creato).localeCompare(String(a.creato)));

  _el.lista.innerHTML = "";
  _el.vuota.classList.toggle("hidden", righe.length > 0);

  for (const r of righe) {
    const p = pendenti.get(r.client_id);
    const li = document.createElement("li");
    li.className = p ? "in-coda" : "consegnato";

    const ora = document.createElement("span");
    ora.className = "reg-ora";
    ora.textContent = _formattaOra(r.creato);

    const cosa = document.createElement("span");
    cosa.className = "reg-cosa";
    cosa.textContent = _descrivi(r);

    const esito = document.createElement("span");
    esito.className = "reg-esito";
    if (p) {
      const tentativi = p.tentativi || 0;
      esito.textContent = tentativi ? `⏳ in coda · ${tentativi} tentativ${tentativi === 1 ? "o" : "i"}` : "⏳ in coda";
      if (p.ultimo_errore) esito.title = p.ultimo_errore;
    } else {
      esito.textContent = "✓ consegnato";
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

function _stato(testo, cls) {
  if (!_el.stato) return;
  _el.stato.textContent = testo;
  _el.stato.className = cls || "";
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

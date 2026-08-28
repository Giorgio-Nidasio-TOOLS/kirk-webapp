/**
 * Il pannello Deposito: foto (0..n) + voce + testo in un pacchetto solo.
 *
 * L'unita' di cattura NON e' il biglietto da visita: e' l'incontro.
 * A volte c'e' un cartoncino, a volte un pezzo di carta, a volte solo la voce
 * o un link dettato. Per questo tutto e' facoltativo, tranne che almeno una
 * delle tre cose ci sia.
 *
 * Foto e voce entrano INSIEME perche' e' la voce a disambiguare la foto: un
 * biglietto puo' contenere due persone (una stampata, una scritta a penna) e
 * non dice quale sia l'interlocutore. Nessun OCR puo' saperlo.
 *
 * Questo pannello contiene L'UNICO MICROFONO dell'app. Prima ce n'erano due,
 * identici e in punti diversi, con destini opposti: uno conservava, l'altro
 * poteva bruciare il lavoro.
 */

import { accoda, nuovoClientId, quanti, osserva, avviaSorveglianza } from "./coda.js";
import { startRecording, stopRecording, isRecording } from "./audio.js";

const MAX_FOTO = 10;
const LATO_MAX = 1600;      // px: oltre non serve per leggere un biglietto
const QUALITA_JPEG = 0.82;

let _foto = [];             // [{b64, anteprima}]
let _audioB64 = null;
let _durataAudio = 0;
let _tRegistrazione = 0;
let _el = {};

// ── avvio ────────────────────────────────────────────────────────────────────

export function inizializzaDeposito() {
  _el = {
    pannello:  document.getElementById("dep-panel"),
    apri:      document.getElementById("dep-btn"),
    chiudi:    document.getElementById("dep-close"),
    fotoInput: document.getElementById("dep-foto-input"),
    fotoBtn:   document.getElementById("dep-foto-btn"),
    galleria:  document.getElementById("dep-galleria"),
    micBtn:    document.getElementById("dep-mic-btn"),
    audioInfo: document.getElementById("dep-audio-info"),
    testo:     document.getElementById("dep-testo"),
    inviaBtn:  document.getElementById("dep-invia-btn"),
    stato:     document.getElementById("dep-stato"),
    contatore: document.getElementById("dep-contatore"),
  };
  if (!_el.pannello) return;

  _el.apri.addEventListener("click", _apri);
  _el.chiudi.addEventListener("click", _chiudi);
  _el.fotoBtn.addEventListener("click", () => _el.fotoInput.click());
  _el.fotoInput.addEventListener("change", _aggiungiFoto);
  _el.micBtn.addEventListener("click", _toggleMic);
  _el.inviaBtn.addEventListener("click", _invia);

  osserva(_mostraContatore);
  avviaSorveglianza();
}

function _apri() {
  _el.pannello.classList.remove("hidden");
  document.getElementById("settings-panel")?.classList.add("hidden");
}

function _chiudi() {
  if (isRecording()) return;   // non si chiude mentre registra
  _el.pannello.classList.add("hidden");
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
      _el.audioInfo.textContent = `🔊 registrati ${_durataAudio}s — tocca per rifare`;
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

  // Il pacchetto va in coda e il pannello si chiude SUBITO: non si aspetta il server.
  await accoda({
    client_id: nuovoClientId(),
    creato_dispositivo: new Date().toISOString(),
    audio: _audioB64,
    foto: _foto.map((f) => f.b64),
    testo: testo || null,
  });

  _reset();
  _stato("✓ In coda — parte da sola appena c'è rete", "ok");
  setTimeout(() => { _stato("", ""); _el.pannello.classList.add("hidden"); }, 1400);
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

// ── stato e contatore ────────────────────────────────────────────────────────

function _stato(testo, cls) {
  if (!_el.stato) return;
  _el.stato.textContent = testo;
  _el.stato.className = cls || "";
}

/**
 * Il contatore e' sempre visibile quando c'e' qualcosa in coda.
 * Se un deposito non e' ancora arrivato al PC, Giorgio lo deve vedere:
 * il fallimento silenzioso e' l'unico che fa perdere fiducia nel canale.
 */
function _mostraContatore(n) {
  if (!_el.contatore) return;
  if (n > 0) {
    _el.contatore.textContent = n === 1 ? "1 da inviare" : `${n} da inviare`;
    _el.contatore.classList.remove("hidden");
    _el.apri.classList.add("ha-coda");
  } else {
    _el.contatore.classList.add("hidden");
    _el.apri.classList.remove("ha-coda");
  }
}

export { quanti as depositiInAttesa };

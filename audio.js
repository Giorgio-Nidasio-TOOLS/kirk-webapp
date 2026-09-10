/**
 * Il registratore. Riscritto l'11/09/2026 dopo un deposito perso.
 *
 * Prima: i pezzi audio vivevano solo in memoria fino a «Ferma», e il
 * registratore aveva un ascoltatore di stop SOLO quando lo fermava Giorgio.
 * Se il sistema toglieva il microfono (schermo bloccato, chiamata in arrivo,
 * altra app), il registratore si fermava da solo, nessuno se ne accorgeva,
 * il pulsante diceva ancora «Ferma», e il tocco successivo AZZERAVA l'audio
 * credendo di iniziarne uno nuovo.
 *
 * Ora:
 *  - un pezzo ogni 3 secondi (`start(3000)`), consegnato subito a chi
 *    registra (onChunk) che lo mette al sicuro nella bozza su disco;
 *  - stop ed errore hanno un ascoltatore FIN DALL'AVVIO: se il registratore
 *    si ferma da solo, il risultato arriva comunque (onFine, spontaneo=true);
 *  - «Ferma» funziona anche se il registratore e' gia' morto: restituisce
 *    quello che c'e'.
 * Cio' che e' stato detto e' salvato: e' la regola «si salva PRIMA di
 * elaborare», applicata alla registrazione stessa.
 */

let _recorder = null;
let _chunks = [];
let _onChunk = null;
let _onFine = null;
let _fermando = null;   // resolve della promise di stopRecording, se in corso

const TIMESLICE_MS = 3000;
const MIME = "audio/webm";

export async function startRecording({ onChunk, onFine } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  _chunks = [];
  _onChunk = onChunk || null;
  _onFine = onFine || null;
  _recorder = new MediaRecorder(stream, { mimeType: MIME });

  _recorder.ondataavailable = (e) => {
    if (!e.data || e.data.size === 0) return;
    _chunks.push(e.data);
    if (_onChunk) {
      try { _onChunk(e.data, _chunks.length); } catch { /* la UI non ferma la registrazione */ }
    }
  };
  _recorder.onerror = (e) => _concludi("errore del registratore: " + (e.error?.message || "sconosciuto"));
  _recorder.onstop = () => _concludi(null);

  // Il sistema puo' togliere il microfono senza passare da «Ferma»: la traccia
  // finisce. Si chiude in ordine e si consegna quello che c'e'.
  stream.getAudioTracks().forEach((t) => {
    t.onended = () => {
      if (_recorder && _recorder.state !== "inactive") {
        try { _recorder.stop(); } catch { _concludi("microfono tolto dal sistema"); }
      } else if (_recorder) {
        _concludi("microfono tolto dal sistema");
      }
    };
  });

  _recorder.start(TIMESLICE_MS);
}

function _concludi(motivo) {
  if (!_recorder) return;
  const rec = _recorder;
  _recorder = null;
  try { rec.stream.getTracks().forEach((t) => t.stop()); } catch { /* gia' chiuse */ }
  const esito = {
    blob: new Blob(_chunks, { type: MIME }),
    motivo,
    spontaneo: !_fermando,
  };
  if (_fermando) {
    const r = _fermando;
    _fermando = null;
    r(esito);
  } else if (_onFine) {
    try { _onFine(esito); } catch { /* niente da fare */ }
  }
}

/**
 * Ferma e restituisce { blob, motivo, spontaneo }. Non fallisce mai: se il
 * registratore e' gia' fermo o morto, restituisce quello che e' stato raccolto.
 */
export function stopRecording() {
  return new Promise((resolve) => {
    if (!_recorder) {
      resolve({ blob: new Blob(_chunks, { type: MIME }), motivo: null, spontaneo: false });
      return;
    }
    _fermando = resolve;
    if (_recorder.state === "inactive") { _concludi(null); return; }
    try {
      _recorder.stop();   // -> ultimo ondataavailable -> onstop -> _concludi
    } catch (e) {
      _concludi(String(e?.message || e));
    }
  });
}

export function isRecording() {
  return _recorder?.state === "recording";
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("lettura audio fallita"));
    reader.readAsDataURL(blob);
  });
}

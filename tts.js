/**
 * Voce di Kirk. Dal 30/08/2026 serve a una cosa sola: il saluto all'apertura.
 * La scelta "audio spento" si RICORDA fra un avvio e l'altro (localStorage):
 * prima si perdeva a ogni riapertura dell'app.
 */

const MUTE_KEY = "kirk_tts_muted";

let _muted = false;
try { _muted = localStorage.getItem(MUTE_KEY) === "1"; } catch { /* storage assente */ }

if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener("voiceschanged", () => {
    window.speechSynthesis.getVoices();
  });
}

export function speak(text) {
  if (_muted || !text || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = "it-IT";
  utt.rate = 1.0;
  const voices = window.speechSynthesis.getVoices();
  const itVoices = voices.filter((v) => v.lang.startsWith("it"));
  const maleVoice = itVoices.find((v) => {
    const n = v.name.toLowerCase();
    return n.includes("male") || n.includes("uomo") || n.includes("cosimo") || n.includes("luca") || n.includes("matteo") || n.includes("giorgio");
  });
  const itVoice = maleVoice || itVoices[0];
  if (itVoice) utt.voice = itVoice;
  window.speechSynthesis.speak(utt);
}

export function stopSpeaking() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

export function toggleMute() {
  _muted = !_muted;
  if (_muted) stopSpeaking();
  try { localStorage.setItem(MUTE_KEY, _muted ? "1" : "0"); } catch { /* storage assente */ }
  return _muted;
}

export function isMuted() {
  return _muted;
}

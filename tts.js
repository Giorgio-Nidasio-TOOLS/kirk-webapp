let _muted = false;

if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener("voiceschanged", () => {
    window.speechSynthesis.getVoices();
  });
}

export function speak(text) {
  if (_muted || !text) return;
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
  window.speechSynthesis.cancel();
}

export function toggleMute() {
  _muted = !_muted;
  if (_muted) stopSpeaking();
  return _muted;
}

export function isMuted() {
  return _muted;
}

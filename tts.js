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
  const itVoice = voices.find((v) => v.lang.startsWith("it"));
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

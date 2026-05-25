import { getConfig, saveConfig, isConfigured, VAPID_PUBLIC_KEY } from "./config.js";
import { sendCommand, getSession, newSession, checkHealth, sendNote } from "./api.js";
import { startRecording, stopRecording, isRecording } from "./audio.js";
import { speak, stopSpeaking, toggleMute } from "./tts.js";
import { loadHistory, addMessage, clearHistory } from "./chat.js";

const micBtn        = document.getElementById("mic-btn");
const textInput     = document.getElementById("text-input");
const sendBtn       = document.getElementById("send-btn");
const statusBar     = document.getElementById("status");
const sessionInfo   = document.getElementById("session-info");
const settingsBtn   = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const muteBtn       = document.getElementById("mute-btn");
const newSessionBtn = document.getElementById("new-session-btn");
const notifBtn      = document.getElementById("notif-btn");
const noteBtn       = document.getElementById("note-btn");
const notePanel     = document.getElementById("note-panel");
const noteText      = document.getElementById("note-text");
const noteMicBtn    = document.getElementById("note-mic-btn");
const noteSendBtn   = document.getElementById("note-send-btn");
const noteStatus    = document.getElementById("note-status");

let _noteRecording = false;

// ── Push notifications ────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function subscribeNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { _updateNotifBtn(); return; }
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) { _updateNotifBtn(); return; }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
    const { serverUrl, token } = getConfig();
    await fetch(`${serverUrl}/push-subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kirk-Token': token,
        'ngrok-skip-browser-warning': '1'
      },
      body: JSON.stringify(sub.toJSON())
    });
  } catch (e) {
    console.warn('Push subscription failed:', e);
  }
  _updateNotifBtn();
}

function _updateNotifBtn() {
  if (!('Notification' in window) || !('PushManager' in window)) {
    notifBtn.style.display = 'none';
    return;
  }
  const perm = Notification.permission;
  notifBtn.style.display = perm === 'granted' ? 'none' : 'inline-flex';
  notifBtn.title = perm === 'denied'
    ? 'Notifiche bloccate — abilita da Impostazioni Chrome'
    : 'Tocca per abilitare le notifiche push';
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  if (!isConfigured()) {
    settingsPanel.classList.remove("hidden");
    _setStatus("Configura URL e token in ⚙️", "warning");
    return;
  }
  loadHistory();
  await _refreshSession();
  try {
    await checkHealth();
    _setStatus("Kirk pronto", "ok");
    setTimeout(() => speak("Ciao Giorgio! Teletrasporto pronto."), 500);
    // Re-subscribe silently only if permission already granted (no user gesture needed)
    if (Notification.permission === 'granted') subscribeNotifications();
    else _updateNotifBtn();
  } catch {
    _setStatus("Kirk non raggiungibile — controlla tunnel e server", "error");
  }
}

// ── Mic button ────────────────────────────────────────────────────────────────

micBtn.addEventListener("click", async () => {
  // Guard: if a note recording is in progress, block main mic
  if (_noteRecording) {
    _setStatus("Ferma la registrazione nota prima di usare il microfono", "warning");
    return;
  }
  if (isRecording()) {
    micBtn.classList.remove("recording");
    _setStatus("Elaborazione audio...", "loading");
    _setBusy(true);
    try {
      const audioB64 = await stopRecording();
      await _sendToKirk("audio", audioB64);
    } catch (err) {
      _setStatus(`Errore: ${err.message}`, "error");
      _setBusy(false);
    }
  } else {
    try {
      await startRecording();
      micBtn.classList.add("recording");
      _setStatus("In ascolto... (premi di nuovo per fermare)", "listening");
    } catch {
      _setStatus("Microfono non disponibile — controlla i permessi", "error");
    }
  }
});

// ── Text send ─────────────────────────────────────────────────────────────────

sendBtn.addEventListener("click", _sendText);
textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); _sendText(); }
});

async function _sendText() {
  const text = textInput.value.trim();
  if (!text) return;
  textInput.value = "";
  _setStatus("Elaborazione...", "loading");
  _setBusy(true);
  await _sendToKirk("text", text);
}

// ── Core send ─────────────────────────────────────────────────────────────────

async function _sendToKirk(type, data) {
  try {
    const result = await sendCommand(type, data);
    addMessage("user", result.transcript);
    addMessage("assistant", result.response);
    speak(result.response);
    _setStatus(`Kirk — ${result.message_count} messaggi`, "ok");
    await _refreshSession();
  } catch (err) {
    _setStatus(`Errore: ${err.message}`, "error");
  } finally {
    _setBusy(false);
  }
}

// ── Note button ───────────────────────────────────────────────────────────────

noteBtn.addEventListener("click", () => {
  notePanel.classList.toggle("hidden");
  settingsPanel.classList.add("hidden");
  if (!notePanel.classList.contains("hidden")) {
    noteText.focus();
  }
});

noteSendBtn.addEventListener("click", async () => {
  const text = noteText.value.trim();
  if (!text) return;
  _setNoteStatus("Salvataggio...", "");
  noteSendBtn.disabled = true;
  try {
    await sendNote("transcript", text);
    _setNoteStatus("✓ Nota salvata", "ok");
    noteText.value = "";
    setTimeout(() => {
      _setNoteStatus("", "");
      notePanel.classList.add("hidden");
    }, 1500);
  } catch (err) {
    _setNoteStatus(`Errore: ${err.message}`, "err");
  } finally {
    noteSendBtn.disabled = false;
  }
});

noteMicBtn.addEventListener("click", async () => {
  if (_noteRecording) {
    noteMicBtn.textContent = "🎤 Registra";
    noteMicBtn.classList.remove("recording");
    _noteRecording = false;
    _setNoteStatus("Salvataggio audio...", "");
    noteMicBtn.disabled = true;
    try {
      const audioB64 = await stopRecording();
      await sendNote("audio", audioB64, "nota.webm");
      _setNoteStatus("✓ Nota salvata", "ok");
      setTimeout(() => {
        _setNoteStatus("", "");
        notePanel.classList.add("hidden");
      }, 1500);
    } catch (err) {
      _setNoteStatus(`Errore: ${err.message}`, "err");
    } finally {
      noteMicBtn.disabled = false;
      micBtn.disabled = false;
    }
  } else {
    // Guard: if main mic is recording, block note mic
    if (isRecording()) {
      _setNoteStatus("Ferma il microfono principale prima di registrare una nota", "err");
      return;
    }
    try {
      await startRecording();
      _noteRecording = true;
      noteMicBtn.textContent = "⏹ Stop";
      noteMicBtn.classList.add("recording");
      _setNoteStatus("Registrazione in corso...", "");
      micBtn.disabled = true;
    } catch {
      _setNoteStatus("Microfono non disponibile", "err");
    }
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────

settingsBtn.addEventListener("click", () => {
  const c = getConfig();
  document.getElementById("server-url").value = c.serverUrl || "";
  document.getElementById("api-token").value  = c.token || "";
  settingsPanel.classList.toggle("hidden");
  notePanel.classList.add("hidden");
});

document.getElementById("save-settings").addEventListener("click", () => {
  const url   = document.getElementById("server-url").value.trim().replace(/\/$/, "");
  const token = document.getElementById("api-token").value.trim();
  if (!url || !token) { alert("Compila URL e token prima di salvare."); return; }
  saveConfig({ serverUrl: url, token });
  settingsPanel.classList.add("hidden");
  init();
});

// ── Session reset ─────────────────────────────────────────────────────────────

newSessionBtn.addEventListener("click", async () => {
  if (!confirm("Iniziare una nuova sessione? La cronologia verrà cancellata.")) return;
  try {
    await newSession();
    clearHistory();
    sessionInfo.textContent = "Nuova sessione";
    _setStatus("Nuova sessione avviata", "ok");
  } catch (err) {
    _setStatus(`Errore reset sessione: ${err.message}`, "error");
  }
});

// ── Notifiche ─────────────────────────────────────────────────────────────────

notifBtn.addEventListener("click", () => subscribeNotifications());

// ── Mute ──────────────────────────────────────────────────────────────────────

muteBtn.addEventListener("click", () => {
  const muted = toggleMute();
  muteBtn.textContent = muted ? "🔇" : "🔊";
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _refreshSession() {
  try {
    const s = await getSession();
    if (s.active && s.created_at) {
      const since = new Date(s.created_at).toLocaleTimeString("it-IT", {
        hour: "2-digit", minute: "2-digit",
      });
      sessionInfo.textContent = `Sessione: ${since} · ${s.message_count} msg`;
    } else {
      sessionInfo.textContent = "Nessuna sessione";
    }
  } catch {
    sessionInfo.textContent = "—";
  }
}

function _setStatus(text, type) {
  statusBar.textContent = text;
  statusBar.className   = type || "";
}

function _setNoteStatus(text, cls) {
  noteStatus.textContent = text;
  noteStatus.className   = cls || "";
}

function _setBusy(busy) {
  micBtn.disabled  = busy;
  sendBtn.disabled = busy;
}

// ── Start ─────────────────────────────────────────────────────────────────────

init();

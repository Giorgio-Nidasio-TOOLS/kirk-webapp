import { getConfig, saveConfig, isConfigured } from "./config.js";
import { sendCommand, getSession, newSession, checkHealth } from "./api.js";
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
const muteFooterBtn = document.getElementById("mute-footer-btn");
const newSessionBtn = document.getElementById("new-session-btn");

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
  } catch {
    _setStatus("Kirk non raggiungibile — controlla tunnel e server", "error");
  }
}

// ── Mic button ────────────────────────────────────────────────────────────────

micBtn.addEventListener("click", async () => {
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

// ── Settings ──────────────────────────────────────────────────────────────────

settingsBtn.addEventListener("click", () => {
  const c = getConfig();
  document.getElementById("server-url").value = c.serverUrl || "";
  document.getElementById("api-token").value  = c.token || "";
  settingsPanel.classList.toggle("hidden");
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

// ── Mute ──────────────────────────────────────────────────────────────────────

function _syncMuteBtns(muted) {
  const icon = muted ? "🔇" : "🔊";
  muteBtn.textContent = icon;
  muteFooterBtn.textContent = icon;
}

muteBtn.addEventListener("click", () => _syncMuteBtns(toggleMute()));
muteFooterBtn.addEventListener("click", () => _syncMuteBtns(toggleMute()));

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

function _setBusy(busy) {
  micBtn.disabled  = busy;
  sendBtn.disabled = busy;
}

// ── Start ─────────────────────────────────────────────────────────────────────

init();

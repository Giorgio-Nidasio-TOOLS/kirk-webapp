import { getConfig, saveConfig, isConfigured, VAPID_PUBLIC_KEY } from "./config.js";
import {
  isBiometricAvailable, isBiometricRegistered,
  registerBiometric, verifyBiometric,
} from "./biometric.js";
import { sendCommand, getSession, newSession, checkHealth } from "./api.js";
import { speak, stopSpeaking, toggleMute } from "./tts.js";
import { loadHistory, addMessage, clearHistory } from "./chat.js";
import { inizializzaDeposito } from "./deposito.js";

/**
 * Riscritto il 29/08/2026.
 *
 * La chat resta, ma SOLO TESTUALE: il microfono dell'app e' uno solo ed e'
 * dentro il Deposito. Prima ce n'erano due, identici, in punti diversi, con
 * destini opposti — uno salvava, l'altro poteva bruciare il lavoro. Non era
 * distrazione di chi lo usava: era l'interfaccia a offrire due volte la stessa
 * cosa con due esiti diversi.
 *
 * Per la conversazione ricca (voce, foto, workspace) c'e' Remote Control, che
 * la fa meglio di quanto potremmo farla qui.
 */

const textInput     = document.getElementById("text-input");
const sendBtn       = document.getElementById("send-btn");
const statusBar     = document.getElementById("status");
const sessionInfo   = document.getElementById("session-info");
const settingsBtn   = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const muteBtn       = document.getElementById("mute-btn");
const newSessionBtn = document.getElementById("new-session-btn");
const notifBtn      = document.getElementById("notif-btn");

// ── Biometric gate ────────────────────────────────────────────────────────────

const _bioGate = document.getElementById("biometric-gate");
const _bioMsg  = document.getElementById("bio-msg");
const _bioBtn  = document.getElementById("bio-btn");

/**
 * Mostra il gate biometrico e risolve a true se l'utente si autentica,
 * oppure a false se il biometrico non è disponibile (app prosegue normalmente).
 * In caso di errore rimane bloccato con messaggio di retry.
 */
async function _runBiometricGate() {
  const available = await isBiometricAvailable();
  if (!available) {
    _bioGate.classList.add("hidden");
    return;
  }

  const registered = isBiometricRegistered();
  _bioMsg.textContent = registered
    ? "Usa la tua impronta digitale per accedere a Kirk"
    : "Prima apertura: registra la tua impronta digitale per proteggere Kirk";
  _bioBtn.textContent = registered ? "Usa impronta digitale  👆" : "Registra impronta  👆";

  await new Promise((resolve) => {
    const handler = async () => {
      _bioBtn.disabled = true;
      _bioMsg.textContent = "In attesa...";
      _bioMsg.className = "";
      try {
        if (!isBiometricRegistered()) {
          await registerBiometric();
          _bioMsg.textContent = "✓ Impronta registrata";
        } else {
          await verifyBiometric();
          _bioMsg.textContent = "✓ Accesso confermato";
        }
        _bioMsg.className = "ok";
        setTimeout(() => {
          _bioGate.classList.add("hidden");
          resolve();
        }, 400);
      } catch (e) {
        _bioBtn.disabled = false;
        const cancelled = e.name === "NotAllowedError";
        _bioMsg.className = "err";
        _bioMsg.textContent = cancelled
          ? "Verifica annullata — premi di nuovo per riprovare"
          : "Errore verifica — premi di nuovo per riprovare";
      }
    };
    _bioBtn.addEventListener("click", handler, { once: false });
  });
}

// Re-verifica al ritorno in foreground dopo >5 minuti di background
let _lastHidden = 0;
const _BIO_TIMEOUT_MS = 5 * 60 * 1000;

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "hidden") {
    _lastHidden = Date.now();
  } else if (
    document.visibilityState === "visible" &&
    isConfigured() &&
    isBiometricRegistered() &&
    Date.now() - _lastHidden > _BIO_TIMEOUT_MS
  ) {
    await _runBiometricGate();
  }
});

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
    const sub = existing || await reg.pushManager.subscribe({
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
    _bioGate.classList.add("hidden");
    settingsPanel.classList.remove("hidden");
    _setStatus("Configura URL e token in ⚙️", "warning");
    return;
  }

  // Gate biometrico — blocca l'app finché l'impronta non viene verificata
  await _runBiometricGate();

  loadHistory();
  await _refreshSession();
  try {
    await checkHealth();
    _setStatus("Kirk pronto", "ok");
    setTimeout(() => speak("Ciao Giorgio! Teletrasporto pronto."), 500);
    if (Notification.permission === 'granted') subscribeNotifications();
    else _updateNotifBtn();
  } catch {
    _setStatus("Kirk non raggiungibile — controlla tunnel e server", "error");
  }
}

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
  document.getElementById("dep-panel")?.classList.add("hidden");
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

function _setBusy(busy) {
  sendBtn.disabled = busy;
}

// ── Start ─────────────────────────────────────────────────────────────────────

// Il Deposito si inizializza SEMPRE, anche prima del gate biometrico e anche se
// Kirk non e' raggiungibile: la coda deve poter accogliere depositi offline.
// In fiera e' proprio la condizione normale.
inizializzaDeposito();

init();

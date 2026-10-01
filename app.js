import { getConfig, saveConfig, isConfigured, VAPID_PUBLIC_KEY } from "./config.js";
import {
  isBiometricAvailable, isBiometricRegistered,
  registerBiometric, verifyBiometric,
} from "./biometric.js";
import { checkHealth } from "./api.js";
import { speak, toggleMute, isMuted } from "./tts.js";
import { inizializzaDeposito } from "./deposito.js";
import { inizializzaNotifiche, apriDaIndirizzo, chiudiBacheca } from "./notifiche.js";

/**
 * Riscritto il 30/08/2026: Kirk e' SOLO il Deposito.
 *
 * La chat e' stata dismessa dopo i test del 29/08: il canale sincrono (voce,
 * foto, workspace) lo fa Remote Control meglio di quanto potessimo farlo qui.
 * Kirk resta il canale ASINCRONO — la cassetta delle lettere che non perde
 * niente — e non ha piu' bisogno di una home: superato il saluto, il Deposito
 * e' gia' davanti.
 *
 * Restano: il gate biometrico (protegge il token), le Impostazioni (URL e
 * token), la campanella delle notifiche (abilita le push e, dal 02/10/2026,
 * apre la BACHECA DELLE NOTIFICHE — notifiche.js) e il saluto vocale, con
 * l'audio spegnibile e la scelta ricordata fra un avvio e l'altro.
 */

const statusBar     = document.getElementById("status");
const settingsBtn   = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const muteBtn       = document.getElementById("mute-btn");
const notifBtn      = document.getElementById("notif-btn");

// ── Biometric gate ────────────────────────────────────────────────────────────

const _bioGate = document.getElementById("biometric-gate");
const _bioMsg  = document.getElementById("bio-msg");
const _bioBtn  = document.getElementById("bio-btn");

/**
 * Mostra il gate biometrico e risolve quando l'utente si autentica,
 * oppure subito se il biometrico non è disponibile (l'app prosegue normalmente).
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
  _bioGate.classList.remove("hidden");

  await new Promise((resolve) => {
    const handler = async () => {
      _bioBtn.disabled = true;
      _bioMsg.textContent = "In attesa...";
      _bioMsg.className = "bio-msg";
      try {
        if (!isBiometricRegistered()) {
          await registerBiometric();
          _bioMsg.textContent = "✓ Impronta registrata";
        } else {
          await verifyBiometric();
          _bioMsg.textContent = "✓ Accesso confermato";
        }
        _bioMsg.className = "bio-msg ok";
        setTimeout(() => {
          _bioGate.classList.add("hidden");
          _bioBtn.removeEventListener("click", handler);
          resolve();
        }, 400);
      } catch (e) {
        _bioBtn.disabled = false;
        const cancelled = e.name === "NotAllowedError";
        _bioMsg.className = "bio-msg err";
        _bioMsg.textContent = cancelled
          ? "Verifica annullata — premi di nuovo per riprovare"
          : "Errore verifica — premi di nuovo per riprovare";
      }
    };
    _bioBtn.addEventListener("click", handler);
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

async function subscribeNotifications(rifaiDaCapo = false) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { _updateNotifBtn(); return; }
    const reg = await navigator.serviceWorker.ready;
    let existing = await reg.pushManager.getSubscription();
    if (existing && rifaiDaCapo) {
      // Dal 02/10/2026: il PC dice che l'iscrizione e' SCADUTA (404/410 dal servizio push).
      // Rimandargli quella che il browser ha in memoria vorrebbe dire rimandargli una morta:
      // si cancella e se ne crea una nuova.
      try { await existing.unsubscribe(); } catch { /* gia' morta: pazienza */ }
      existing = null;
    }
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
  // Dal 02/10/2026 (v24) la campanella e' SEMPRE visibile: apre la bacheca delle notifiche
  // (notifiche.js). Finche' il permesso delle push manca, il primo tocco lo chiede.
  notifBtn.style.display = 'inline-flex';
  const push = ('Notification' in window) && ('PushManager' in window);
  const perm = push ? Notification.permission : 'unsupported';
  notifBtn.title = perm === 'default' ? 'Tocca per abilitare le notifiche push'
    : perm === 'denied' ? 'Bacheca delle notifiche (push bloccate: riabilitale da Impostazioni Chrome)'
    : 'Bacheca delle notifiche';
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

  // Il saluto: la voce parte appena si e' dentro, non aspetta il server.
  // Se il PC e' spento (in fiera e' normale) il Deposito funziona lo stesso.
  setTimeout(() => speak("Ciao Giorgio! Teletrasporto pronto."), 300);

  await _verificaCollegamento();
  // Tocco su una push con Kirk chiuso: «/kirk-webapp/?notifica=<id>» (dal 02/10/2026).
  apriDaIndirizzo();
}

/** Stato del collegamento col PC. Non e' bloccante: la coda regge comunque. */
async function _verificaCollegamento() {
  if (!navigator.onLine) {
    _setStatus("Offline — i depositi restano in coda e partono da soli", "warning");
    return;
  }
  try {
    const h = await checkHealth();
    // Dall'11/09/2026: il PC dice se il token e' quello giusto. Dopo una rotazione
    // dei segreti la PWA vedeva «Kirk pronto» e poi falliva in silenzio sul deposito.
    if (h && h.token_ok === false) {
      _setStatus("⚠️ Token non valido: apri ⚙️ e incolla quello nuovo — i depositi restano in coda", "error");
      chiudiBacheca();   // un pannello alla volta (02/10/2026)
      settingsPanel.classList.remove("hidden");
      return;
    }
    _setStatus("Kirk pronto — collegato al PC", "ok");
    window.dispatchEvent(new Event("kirk:collegato"));   // il registro si fa confermare
    if ('Notification' in window && Notification.permission === 'granted') {
      subscribeNotifications(Boolean(h && h.push_scaduta));   // 02/10/2026: scaduta -> da capo
    } else {
      _updateNotifBtn();
    }
  } catch {
    _setStatus("PC non raggiungibile — i depositi restano in coda", "warning");
  }
}

window.addEventListener("online",  () => { if (isConfigured()) _verificaCollegamento(); });
window.addEventListener("offline", () => { if (isConfigured()) _verificaCollegamento(); });

// ── Settings ──────────────────────────────────────────────────────────────────

settingsBtn.addEventListener("click", () => {
  const c = getConfig();
  document.getElementById("server-url").value = c.serverUrl || "";
  document.getElementById("api-token").value  = c.token || "";
  settingsPanel.classList.toggle("hidden");
});

document.getElementById("close-settings").addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
});

document.getElementById("save-settings").addEventListener("click", () => {
  const url   = document.getElementById("server-url").value.trim().replace(/\/$/, "");
  const token = document.getElementById("api-token").value.trim();
  if (!url || !token) { alert("Compila URL e token prima di salvare."); return; }
  saveConfig({ serverUrl: url, token });
  settingsPanel.classList.add("hidden");
  init();
});

// ── Notifiche ─────────────────────────────────────────────────────────────────
// Dal 02/10/2026 (v24) il tocco sulla campanella lo gestisce notifiche.js: apre la bacheca,
// oppure chiede il permesso delle push finche' manca (abilitaNotifiche, all'avvio qui sotto).

// ── Audio del saluto (scelta ricordata fra un avvio e l'altro) ───────────────

function _disegnaMute() {
  const muted = isMuted();
  muteBtn.textContent = muted ? "🔇" : "🔊";
  muteBtn.title = muted ? "Saluto vocale spento — tocca per riaccenderlo"
                        : "Saluto vocale acceso — tocca per spegnerlo";
}
muteBtn.addEventListener("click", () => { toggleMute(); _disegnaMute(); });
_disegnaMute();

// ── Helpers ───────────────────────────────────────────────────────────────────

function _setStatus(text, type) {
  statusBar.textContent = text;
  statusBar.className   = type || "";
}

// ── Start ─────────────────────────────────────────────────────────────────────

// Il Deposito si inizializza SEMPRE, anche prima del gate biometrico e anche se
// Kirk non e' raggiungibile: la coda deve poter accogliere depositi offline.
// In fiera e' proprio la condizione normale.
inizializzaDeposito();
try {
  inizializzaNotifiche({ abilitaNotifiche: () => subscribeNotifications() });
} catch (e) {
  // Il Deposito non deve mai dipendere dalla bacheca (01/10/2026): se la bacheca non parte (per esempio
  // index.html e app.js di versioni diverse durante la pubblicazione), l'app va avanti senza.
  console.warn("Bacheca delle notifiche non avviata:", e);
}
_updateNotifBtn();

init();

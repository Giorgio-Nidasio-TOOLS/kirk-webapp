const CONFIG_KEY = "kirk_config";

export function getConfig() {
  const stored = localStorage.getItem(CONFIG_KEY);
  return stored ? JSON.parse(stored) : { serverUrl: "", token: "" };
}

export function saveConfig({ serverUrl, token }) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ serverUrl, token }));
}

export function isConfigured() {
  const c = getConfig();
  return Boolean(c.serverUrl && c.token);
}

// Chiave pubblica VAPID ruotata il 10/09/2026 (audit 2026-09, M1): la privata vive fuori OneDrive.
// Dopo una rotazione la vecchia subscription push non vale piu': riattivare il campanello nella PWA.
export const VAPID_PUBLIC_KEY = 'BBMUD9mqXbYCoL4BpftM-mIl5Fl5ujU5LuWs65OxnTi4vlhIPRInpw97f0teR_f4NfDIm7gcasGmwLIHW0VZuAY';

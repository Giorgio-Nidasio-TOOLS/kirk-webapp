import { getConfig } from "./config.js";

/**
 * Dal 30/08/2026 la PWA parla col backend per due sole cose:
 *  - /deposito  — il pacchetto (foto + voce + testo), via coda.js
 *  - /health    — lo stato del collegamento col PC
 * (/push-subscribe e' chiamato direttamente da app.js).
 * /command, /session e /note non esistono piu' lato PWA: la chat e' dismessa.
 */

async function request(path, options = {}) {
  const { serverUrl, token } = getConfig();
  const url = `${serverUrl}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Kirk-Token": token,
      "ngrok-skip-browser-warning": "1",
      ...(options.headers || {}),
    },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || `HTTP ${resp.status}`);
  }
  return resp.json();
}

/**
 * Invia un pacchetto del Deposito.
 *
 * Timeout esplicito: il server risponde SUBITO dopo aver scritto i byte su disco
 * (la trascrizione gira dopo, in background), quindi un'attesa lunga significa
 * rete morta, non elaborazione in corso. Restare appesi qui bloccherebbe la coda.
 */
export async function inviaDeposito(pacchetto) {
  const { serverUrl, token } = getConfig();
  if (!serverUrl || !token) throw new Error("Kirk non configurato");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch(`${serverUrl}/deposito`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Kirk-Token": token,
        "ngrok-skip-browser-warning": "1",
      },
      body: JSON.stringify(pacchetto),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || `HTTP ${resp.status}`);
    }
    return resp.json();
  } finally {
    clearTimeout(timer);
  }
}

export function checkHealth() {
  return request("/health");
}

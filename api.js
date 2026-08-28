import { getConfig } from "./config.js";

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

export function sendCommand(type, data) {
  return request("/command", {
    method: "POST",
    body: JSON.stringify({ type, data }),
  });
}

export function sendNote(type, data, filename = null) {
  return request("/note", {
    method: "POST",
    body: JSON.stringify({ type, data, filename }),
  });
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

export function getSession() {
  return request("/session");
}

export function newSession() {
  return request("/session/new", { method: "POST" });
}

export function checkHealth() {
  return request("/health");
}

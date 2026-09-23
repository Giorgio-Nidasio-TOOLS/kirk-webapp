import { getConfig } from "./config.js";

/**
 * Dal 30/08/2026 la PWA parla col backend per poche cose:
 *  - /deposito           — il pacchetto (foto + voce + testo), via coda.js
 *  - /health             — lo stato del collegamento col PC (e se il token e' quello giusto)
 *  - /depositi/verifica  — il registro si fa CONFERMARE dal PC (dall'11/09/2026)
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

/**
 * Chiede al PC quali di questi depositi ha DAVVERO ricevuto.
 * Risponde { presenti: [...], mancanti: [...] }. Con la stessa chiamata il
 * telefono dichiara quanti pacchetti ha in coda e se c'e' una bozza: il PC
 * lo scrive nel log e il Tool 04 lo sorveglia.
 */
export function verificaDepositi(client_ids, in_coda = 0, bozza = false, extra = {}) {
  // Dal 23/09/2026 (v23) `extra` porta il DIARIO della coda e gli SPARITI:
  // il PC li conserva e li logga, il Tool 04 li sorveglia (incidente 22/09).
  return request("/depositi/verifica", {
    method: "POST",
    body: JSON.stringify({ client_ids, in_coda, bozza, ...extra }),
  });
}

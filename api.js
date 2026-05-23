import { getConfig } from "./config.js";

async function request(path, options = {}) {
  const { serverUrl, token } = getConfig();
  const url = `${serverUrl}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Kirk-Token": token,
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

export function getSession() {
  return request("/session");
}

export function newSession() {
  return request("/session/new", { method: "POST" });
}

export function checkHealth() {
  return request("/health");
}

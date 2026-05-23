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

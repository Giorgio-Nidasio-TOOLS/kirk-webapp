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

export const VAPID_PUBLIC_KEY = 'BNbH1AWGWM8eThd74nRni6n9DMGFyc8KPgaq9ml7LR3abXEs_zn--T_fti6IvRvNU6FLmei7_8JoKO5QKoEo_5A';

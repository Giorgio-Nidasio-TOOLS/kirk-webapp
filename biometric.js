/**
 * biometric.js — WebAuthn local biometric gate per Kirk PWA.
 * Usa il Platform Authenticator del dispositivo (impronta, PIN schermo).
 * Nessuna comunicazione col server: protezione locale contro accesso fisico.
 * La credential è legata al dominio giorgio-nidasio-tools.github.io.
 */

const CRED_KEY = "kirk_biometric_cred_id_b64";
const RP_ID    = "giorgio-nidasio-tools.github.io";

/** Verifica se il dispositivo ha un autenticatore biometrico/platform disponibile. */
export async function isBiometricAvailable() {
  if (!window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** True se l'impronta è già stata registrata su questo dispositivo. */
export function isBiometricRegistered() {
  return Boolean(localStorage.getItem(CRED_KEY));
}

/** Registra l'impronta. Salva l'ID della credential in localStorage. */
export async function registerBiometric() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { id: RP_ID, name: "Kirk" },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: "giorgio",
        displayName: "Giorgio",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },    // ES256
        { type: "public-key", alg: -257 },   // RS256 — fallback alcuni dispositivi
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60000,
    },
  });
  const idB64 = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
  localStorage.setItem(CRED_KEY, idB64);
}

/** Verifica l'impronta. Lancia eccezione se fallisce o viene annullata. */
export async function verifyBiometric() {
  const idB64 = localStorage.getItem(CRED_KEY);
  if (!idB64) throw new Error("Nessuna credential registrata");
  const credId = Uint8Array.from(atob(idB64), (c) => c.charCodeAt(0));
  await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: "public-key", id: credId }],
      userVerification: "required",
      timeout: 60000,
    },
  });
}

/** Rimuove la registrazione (es. per debug o reset dispositivo). */
export function clearBiometricRegistration() {
  localStorage.removeItem(CRED_KEY);
}

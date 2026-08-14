const STORAGE_KEY = "orquester.credentials.v1";
const ITERATIONS = 310_000;

interface StoredVault {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
}

export interface StoredCredential {
  username: string;
  password: string;
}

type CredentialMap = Record<string, StoredCredential>;

let unlocked: CredentialMap | null = null;
let unlockedPin: string | null = null;

const encode = (value: Uint8Array): string => {
  let binary = "";
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};

const decode = (value: string): Uint8Array => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

function readStoredVault(): StoredVault | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredVault>;
    if (value.version !== 1 || !value.salt || !value.iv || !value.ciphertext) return null;
    return value as StoredVault;
  } catch {
    return null;
  }
}

async function keyFromPin(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin) as unknown as BufferSource, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encrypt(pin: string, credentials: CredentialMap): Promise<StoredVault> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFromPin(pin, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(credentials));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, plaintext as unknown as BufferSource);
  return { version: 1, salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}

async function decrypt(pin: string, stored: StoredVault): Promise<CredentialMap | null> {
  try {
    const key = await keyFromPin(pin, decode(stored.salt));
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(stored.iv) as unknown as BufferSource }, key, decode(stored.ciphertext) as unknown as BufferSource);
    const value = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as CredentialMap;
  } catch {
    return null;
  }
}

function askPin(message: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  const pin = window.prompt(message);
  return pin && pin.length >= 4 ? pin : undefined;
}

async function unlockExisting(): Promise<CredentialMap | null> {
  if (unlocked) return unlocked;
  const stored = readStoredVault();
  if (!stored) return null;

  const pin = askPin("Enter your Orquester credential vault PIN:");
  if (!pin) return null;
  const credentials = await decrypt(pin, stored);
  if (!credentials) {
    window.alert("That PIN could not unlock the credential vault.");
    return null;
  }
  unlocked = credentials;
  unlockedPin = pin;
  return unlocked;
}

async function ensureUnlockedForSave(): Promise<CredentialMap | null> {
  if (unlocked) return unlocked;
  const stored = readStoredVault();
  if (stored) return unlockExisting();
  const pin = askPin("Create a PIN to protect saved Orquester worker credentials (at least 4 characters):");
  if (!pin) return null;
  unlocked = {};
  unlockedPin = pin;
  try {
    const encrypted = await encrypt(pin, unlocked);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(encrypted));
    return unlocked;
  } catch {
    unlocked = null;
    unlockedPin = null;
    return null;
  }
}

export async function loadCredential(endpoint: string): Promise<StoredCredential | undefined> {
  const credentials = await unlockExisting();
  return credentials?.[endpoint];
}

export async function saveCredential(endpoint: string, credential: StoredCredential): Promise<boolean> {
  const credentials = await ensureUnlockedForSave();
  if (!credentials || !unlockedPin) return false;
  credentials[endpoint] = { ...credential };
  // Keep the in-memory vault unlocked; only the encrypted representation is persisted.
  const encrypted = await encrypt(unlockedPin, credentials);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(encrypted));
    return true;
  } catch {
    return false;
  }
}

export function forgetCredential(endpoint: string): void {
  if (unlocked) delete unlocked[endpoint];
}

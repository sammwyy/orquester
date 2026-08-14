import bcrypt from "bcryptjs";

/**
 * Web auth for the HTTP transport: the daemon stores a bcrypt hash of the
 * password and publishes its salt. The client derives the SAME hash from the
 * typed password + salt and uses it as the bearer. The old hash storage is
 * retained only so existing clients can recover without losing a connection;
 * new credentials are stored in the encrypted credential vault.
 */
export function deriveAuthHash(password: string, salt: string): string {
  return bcrypt.hashSync(password, salt);
}

const keyFor = (endpoint: string) => `orquester.auth:${endpoint}`;

export function loadStoredHash(endpoint: string): string | undefined {
  try {
    return localStorage.getItem(keyFor(endpoint)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function clearStoredHash(endpoint: string): void {
  try {
    localStorage.removeItem(keyFor(endpoint));
  } catch {
    /* storage unavailable */
  }
}

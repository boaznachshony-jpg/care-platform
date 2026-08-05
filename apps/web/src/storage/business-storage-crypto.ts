import { gcm } from '@noble/ciphers/aes.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/ciphers/utils.js';

const KEY_SESSION_NAME = 'caredesk.cache-key.v1';
const ENCRYPTED_PREFIX = 'caredesk-encrypted-v1:';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
let cachedKey: Uint8Array | undefined;

function browserAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

function sessionKey(): Uint8Array {
  if (cachedKey) return cachedKey;
  if (!browserAvailable()) throw new Error('Encrypted browser storage is unavailable.');

  const existing = window.sessionStorage.getItem(KEY_SESSION_NAME);
  if (existing) {
    try {
      const decoded = hexToBytes(existing);
      if (decoded.length === KEY_BYTES) {
        cachedKey = decoded;
        return decoded;
      }
    } catch {
      // Replace malformed or legacy key material below.
    }
  }

  const created = randomBytes(KEY_BYTES);
  window.sessionStorage.setItem(KEY_SESSION_NAME, bytesToHex(created));
  cachedKey = created;
  return created;
}

/** Encrypts the device cache. The server remains the source of truth. */
export function encryptBusinessStorageValue(plaintext: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = gcm(sessionKey(), nonce).encrypt(new TextEncoder().encode(plaintext));
  return `${ENCRYPTED_PREFIX}${bytesToHex(nonce)}:${bytesToHex(ciphertext)}`;
}

/** Reads encrypted values and accepts legacy plaintext once for safe migration. */
export function decryptBusinessStorageValue(stored: string): string | null {
  if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored;
  try {
    const [nonceHex, ciphertextHex] = stored.slice(ENCRYPTED_PREFIX.length).split(':');
    if (!nonceHex || !ciphertextHex) return null;
    const plaintext = gcm(sessionKey(), hexToBytes(nonceHex)).decrypt(hexToBytes(ciphertextHex));
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

export function clearBusinessStorageKey(): void {
  cachedKey?.fill(0);
  cachedKey = undefined;
  if (browserAvailable()) window.sessionStorage.removeItem(KEY_SESSION_NAME);
}

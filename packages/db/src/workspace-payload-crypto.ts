import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope for `tenant_workspace.payload`, with the tenant id as
 * additional authenticated data so a payload cannot be moved between tenants.
 *
 * This lives in its own module because three readers now need it: the workspace
 * repository, the version-history read path (0035 archives the payload exactly
 * as stored, which means still encrypted), and the nightly census, which counts
 * populated entries and has to open the payload to do so. Duplicating the
 * envelope format across three files is how the three stop agreeing.
 */

const ENCRYPTED_MARKER = '__caredesk_encrypted_workspace_v1';

export interface EncryptedWorkspaceEnvelope extends Record<string, string> {
  [ENCRYPTED_MARKER]: 'aes-256-gcm';
  iv: string;
  ciphertext: string;
  authTag: string;
}

export function isEncryptedEnvelope(
  payload: Record<string, string>,
): payload is EncryptedWorkspaceEnvelope {
  return payload[ENCRYPTED_MARKER] === 'aes-256-gcm';
}

function decodeKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) throw new Error('Workspace encryption key must contain 32 bytes');
  return key;
}

export function encryptPayload(
  payload: Record<string, string>,
  tenantId: string,
  encodedKey?: string,
): Record<string, string> {
  if (!encodedKey) return payload;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', decodeKey(encodedKey), iv);
  cipher.setAAD(Buffer.from(tenantId, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return {
    [ENCRYPTED_MARKER]: 'aes-256-gcm',
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptPayload(
  payload: Record<string, string>,
  tenantId: string,
  encodedKey?: string,
): Record<string, string> {
  if (!isEncryptedEnvelope(payload)) return payload;
  if (!encodedKey) throw new Error('Encrypted workspace cannot be read without its encryption key');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    decodeKey(encodedKey),
    Buffer.from(payload.iv, 'base64'),
  );
  decipher.setAAD(Buffer.from(tenantId, 'utf8'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext) as Record<string, string>;
}

/**
 * Counts populated entries without letting the payload escape.
 *
 * The census and the version listing both need "how much data is in there"
 * and neither is allowed to hold the answer's contents - the census output goes
 * to logs, the listing goes to a browser. Returning `null` on failure rather
 * than throwing is deliberate: a payload that will not open is the single most
 * important thing the detector can report, and an exception at that point would
 * end the scan instead of raising the finding.
 */
export function countPopulatedEntries(
  payload: Record<string, string>,
  tenantId: string,
  encodedKey?: string,
): number | null {
  try {
    const plain = decryptPayload(payload, tenantId, encodedKey);
    return Object.values(plain).filter((value) => String(value).trim() !== '').length;
  } catch {
    return null;
  }
}

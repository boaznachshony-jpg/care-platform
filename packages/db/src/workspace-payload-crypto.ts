import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

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
  /**
   * Which key sealed this row. Absent on every row written before this field
   * existed - the index signature is what carries that absence, since the
   * envelope is stored as a flat string map and an optional property cannot be
   * declared alongside a `string` index type.
   */
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

/**
 * A stable public name for a key, derived from the key itself.
 *
 * Deriving it rather than configuring it matters: an operator who has to invent
 * and register an id alongside the key will eventually mismatch the two, and a
 * mismatched id is indistinguishable from a lost key. Here the id cannot
 * disagree with the key it names, and rotation needs no second variable.
 *
 * It is a truncated SHA-256 of the key bytes. It is written into every row and
 * therefore must not weaken the key: 64 bits of a one-way digest reveals nothing
 * about a 256-bit secret, and the digest is over the raw bytes, never the
 * base64 text, so re-encoding the same key yields the same id.
 */
export function keyFingerprint(encodedKey: string): string {
  return createHash('sha256').update(decodeKey(encodedKey)).digest('hex').slice(0, 16);
}

function asKeyList(keys: string | readonly string[] | undefined): readonly string[] {
  if (!keys) return [];
  return typeof keys === 'string' ? [keys] : keys.filter((key) => key.length > 0);
}

/**
 * Writes always use the first key supplied. Rotation is therefore "put the new
 * key first, keep the old one behind it" - new rows are sealed with the new key
 * from the next request onward, and old rows keep opening until something
 * rewrites them.
 */
export function encryptPayload(
  payload: Record<string, string>,
  tenantId: string,
  keys?: string | readonly string[],
): Record<string, string> {
  const [encodedKey] = asKeyList(keys);
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
    keyId: keyFingerprint(encodedKey),
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

function openWith(
  envelope: EncryptedWorkspaceEnvelope,
  tenantId: string,
  encodedKey: string,
): Record<string, string> {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    decodeKey(encodedKey),
    Buffer.from(envelope.iv, 'base64'),
  );
  decipher.setAAD(Buffer.from(tenantId, 'utf8'));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext) as Record<string, string>;
}

/**
 * Reads accept every key the deployment holds.
 *
 * With a `keyId` the right key is chosen directly, and a row whose key is not
 * present fails immediately with a message naming the missing id rather than
 * after a pointless sweep. Without one - every row written before this field
 * existed - each key is tried in turn. GCM authenticates, so a wrong key cannot
 * silently produce plausible plaintext; it throws, and the loop moves on.
 */
export function decryptPayload(
  payload: Record<string, string>,
  tenantId: string,
  keys?: string | readonly string[],
): Record<string, string> {
  if (!isEncryptedEnvelope(payload)) return payload;
  const available = asKeyList(keys);
  if (available.length === 0) {
    throw new Error('Encrypted workspace cannot be read without its encryption key');
  }

  const { keyId } = payload;
  if (keyId) {
    const match = available.find((key) => keyFingerprint(key) === keyId);
    if (!match) {
      // Naming the id is safe - it is a public label - and it is the one detail
      // that turns "cannot decrypt" into an actionable statement about which
      // key is missing from the deployment.
      throw new Error(`No configured workspace encryption key matches keyId ${keyId}`);
    }
    return openWith(payload, tenantId, match);
  }

  let lastError: unknown;
  for (const key of available) {
    try {
      return openWith(payload, tenantId, key);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Encrypted workspace could not be opened with any configured key');
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
  keys?: string | readonly string[],
): number | null {
  try {
    const plain = decryptPayload(payload, tenantId, keys);
    return Object.values(plain).filter((value) => String(value).trim() !== '').length;
  } catch {
    return null;
  }
}

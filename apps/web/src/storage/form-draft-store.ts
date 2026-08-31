/**
 * Device-local drafts for long forms.
 *
 * WHY A SEPARATE NAMESPACE (`caredesk.draft.*`)
 * --------------------------------------------
 * Code review WEB-02: the payroll wizard keeps ~20 typed fields in `useState`
 * and persists nothing until the last step, so one mis-tap on the mobile
 * bottom nav destroys a month of entry. The fix is autosave — but autosave
 * must NOT land in `caredesk.mvp.*`:
 *
 *   1. ADR-006 clause 5 freezes the MVP workspace payload, and
 *      scripts/check-adr-006-freeze.mjs fails `pnpm lint` on a new
 *      `caredesk.mvp.*` key. A draft is new data.
 *   2. `replaceMvpWorkspace` wipes and rewrites every `caredesk.mvp.*` key on
 *      each server hydration (see WEB-03). A draft stored there would be
 *      destroyed by the very background sync it has to survive.
 *   3. A draft may hold invalid, half-typed values. Nothing that feeds
 *      reminders, reports or the server may be able to read it by accident.
 *
 * `caredesk.draft.*` is therefore a deliberately separate, never-synced,
 * device-only namespace: not part of the workspace payload, not uploaded, and
 * discarded once the real record is committed.
 *
 * Values are encrypted with the same device cache key as business storage —
 * a payroll draft contains salary figures.
 */
import {
  decryptBusinessStorageValue,
  encryptBusinessStorageValue,
} from './business-storage-crypto.js';
import { clientIdFromPath } from './mvp-storage.js';

const DRAFT_PREFIX = 'caredesk.draft.';
const CLIENT_KEY_SEPARATOR = '.client.';

/** A draft nobody came back to is stale input, not recoverable work. */
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * WEB-06: every localStorage write in this app was unguarded, so a
 * QuotaExceededError (or Safari private browsing, which throws outright)
 * propagated out of a click handler and React 18 unmounted the whole tree —
 * a blank page at the exact moment the user pressed save. Draft writes are
 * the most frequent writes in the product, so they carry a typed failure the
 * caller can show inline instead of a crash.
 */
export class DraftStorageError extends Error {
  constructor(
    readonly draftName: string,
    readonly reason: unknown,
  ) {
    super(`Draft "${draftName}" could not be stored.`);
    this.name = 'DraftStorageError';
  }
}

export interface StoredDraft<T> {
  /** ISO timestamp of the last autosave. */
  savedAt: string;
  value: T;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/**
 * Drafts are scoped to the employer whose screen produced them, exactly like
 * the committed records are. Without this, switching employers would offer
 * one employer's payroll figures inside another employer's wizard.
 */
export function formDraftKey(name: string, clientId = clientIdFromPath()): string {
  const base = `${DRAFT_PREFIX}${name}.v1`;
  return clientId ? `${base}${CLIENT_KEY_SEPARATOR}${clientId}` : base;
}

export function readFormDraft<T>(name: string, now = Date.now()): StoredDraft<T> | null {
  if (!isBrowser()) return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(formDraftKey(name));
  } catch {
    // A read can throw in the same environments a write can.
    return null;
  }
  if (raw === null) return null;
  try {
    const decrypted = decryptBusinessStorageValue(raw);
    if (decrypted === null) return null;
    const parsed = JSON.parse(decrypted) as Partial<StoredDraft<T>>;
    if (typeof parsed?.savedAt !== 'string' || parsed.value === undefined) return null;
    const savedAtMs = Date.parse(parsed.savedAt);
    if (Number.isFinite(savedAtMs) && now - savedAtMs > DRAFT_MAX_AGE_MS) {
      clearFormDraft(name);
      return null;
    }
    return { savedAt: parsed.savedAt, value: parsed.value as T };
  } catch {
    // An unreadable draft must never take a screen down with it: the user
    // simply starts from the committed record.
    return null;
  }
}

/** @throws DraftStorageError when the device refuses the write. */
export function saveFormDraft<T>(name: string, value: T, savedAt = new Date().toISOString()): void {
  if (!isBrowser()) return;
  const payload: StoredDraft<T> = { savedAt, value };
  try {
    window.localStorage.setItem(
      formDraftKey(name),
      encryptBusinessStorageValue(JSON.stringify(payload)),
    );
  } catch (reason) {
    throw new DraftStorageError(name, reason);
  }
}

export function clearFormDraft(name: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(formDraftKey(name));
  } catch {
    // Nothing useful to do; the draft simply expires instead.
  }
}

/** Every draft on this device, for the sign-out / account-switch teardown. */
export function clearAllFormDrafts(): void {
  if (!isBrowser()) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(DRAFT_PREFIX)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Best effort only.
  }
}

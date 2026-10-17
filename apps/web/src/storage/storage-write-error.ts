/* eslint-disable no-restricted-syntax -- Hebrew failure text for the MVP screens; localization extraction is tracked */

/**
 * I. A write to this device's workspace that did not happen.
 *
 * `localStorage.setItem` throws when the browser's quota is full, or when
 * storage is blocked (private browsing in some browsers, site data switched
 * off). Until now that exception left the screens' `persist()` helpers
 * uncaught. On the medications and reminder-recipient screens the list had
 * already been put into React state, so the new row stayed on screen as if it
 * had been saved and was gone on the next visit. On the tasks and documents
 * screens the success message was never reached, and the screen said nothing
 * at all. A write that fails silently is the worst bug class this product has
 * (CLAUDE.md §2).
 *
 * `writeBusinessItem` now throws this one type, and every `persist()` catches
 * it, leaves the screen showing what is actually stored, and says so.
 * `DraftStorageError` in `form-draft-store.ts` is the same idea for drafts.
 */
export type StorageWriteFailure = 'quota' | 'blocked' | 'unknown';

function classify(reason: unknown): StorageWriteFailure {
  if (typeof reason !== 'object' || reason === null) return 'unknown';
  const { name, code } = reason as { name?: unknown; code?: unknown };
  // 22 and 1014 are the legacy numeric codes older WebKit and Firefox use.
  if (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  ) {
    return 'quota';
  }
  if (name === 'SecurityError') return 'blocked';
  return 'unknown';
}

export class StorageWriteError extends Error {
  readonly failure: StorageWriteFailure;

  constructor(
    readonly key: string,
    readonly reason: unknown,
  ) {
    super(`Device storage refused the write to "${key}".`);
    this.name = 'StorageWriteError';
    this.failure = classify(reason);
  }
}

const WHY: Record<StorageWriteFailure, string> = {
  quota: 'אין מספיק מקום פנוי באחסון של הדפדפן במכשיר הזה.',
  blocked: 'הדפדפן חוסם שמירה במכשיר הזה (למשל בגלישה פרטית).',
  unknown: 'הדפדפן סירב לשמור את הנתונים.',
};

/**
 * What the screen says. It never claims the change was kept, and it never
 * shows `error.message`, which carries a storage key.
 */
export function storageWriteFailureMessage(error: unknown): string {
  return `השמירה נכשלה והשינוי לא נשמר: ${storageWriteFailureReason(error)} המסך מציג רק את מה שנשמר בפועל. נסו שוב, ואם זה חוזר — אל תסגרו את הדף לפני שתפנו לתמיכה.`;
}

/** Why the device refused, as one sentence, for a screen that words the rest itself. */
export function storageWriteFailureReason(error: unknown): string {
  return WHY[error instanceof StorageWriteError ? error.failure : 'unknown'];
}

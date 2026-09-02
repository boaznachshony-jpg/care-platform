import { MAX_DOCUMENT_BYTES } from '@caredesk/schemas';
import { getBrowserAuthClient } from '../auth/client.js';
import {
  ApiRequestError,
  deleteWorkspaceFile,
  getWorkspaceFileUrl,
  uploadWorkspaceFile,
} from '../api/client.js';
import { clientIdFromPath } from './mvp-storage.js';

const DATABASE_NAME = 'caredesk.mvp.files.v1';
const STORE_NAME = 'document-files';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/**
 * The workspace file API is scoped to a client, and the client id is only in
 * the path on the `/clients/:clientId/...` routes. On the unscoped `/documents`
 * route there is none.
 *
 * This used to throw `workspace-client-id-required`, which the upload screen
 * caught in a blanket `catch` and reported as "could not save the file on this
 * device — check you are not browsing privately". So a signed-in customer on
 * `/documents` could never attach a file, and the message sent them to fix
 * something unrelated. Reported from production: "עדיין לא ניתן לעלות קובץ".
 *
 * Returning null instead lets the caller store the file where the rest of that
 * record already lives — the unscoped local store — rather than failing. It is
 * not a silent downgrade: the metadata for an unscoped document is local too,
 * so the file and its record stay together either way.
 */
function workspaceClientId(): string | null {
  return clientIdFromPath();
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexed-db-open-failed'));
  });
}

export async function saveDocumentFile(id: string, file: File): Promise<void> {
  const clientId = workspaceClientId();
  if (getBrowserAuthClient() && clientId) {
    await uploadWorkspaceFile(clientId, id, {
      mediaType: file.type as 'application/pdf' | 'image/jpeg' | 'image/png',
      content: toBase64(new Uint8Array(await file.arrayBuffer())),
    });
    return;
  }
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(file, id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('indexed-db-write-failed'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('indexed-db-write-aborted'));
    });
  } finally {
    database.close();
  }
}

/**
 * Reads straight out of this browser's IndexedDB cache, independent of the
 * current route. Extracted out of `readDocumentFile`'s fallback branch so it
 * can also be called from `readLocalDocumentFileForImport` below: the legacy
 * cutover import runs from `/documents` and `/cases/:caseId`, never from
 * `/clients/:clientId`, so `workspaceClientId()` (route-based) would always
 * read as "not scoped" there even for a file this browser genuinely holds in
 * IndexedDB.
 */
async function readIndexedDbBlob(id: string): Promise<Blob | null> {
  const database = await openDatabase();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
      request.onerror = () => reject(request.error ?? new Error('indexed-db-read-failed'));
    });
  } finally {
    database.close();
  }
}

export async function readDocumentFile(id: string): Promise<Blob | string | null> {
  const clientId = workspaceClientId();
  if (getBrowserAuthClient() && clientId) {
    return (await getWorkspaceFileUrl(clientId, id)).url;
  }
  return readIndexedDbBlob(id);
}

/**
 * Defect 3 fix: a locally-held file this browser knows exists but that is
 * larger than the server will ever accept (`MAX_DOCUMENT_BYTES`,
 * packages/schemas). This used to be treated exactly like "there is no file
 * at all" — `blobToImportFile` returned `null`, the metadata imported
 * successfully, `failedIds` stayed empty, and the sync banner said
 * everything worked while the scan itself silently never left the device.
 * That is the worst kind of bug for a backup feature: confident, wrong
 * reassurance about a passport or visa scan the family believes is safe.
 *
 * Throwing instead of returning null makes this indistinguishable, from the
 * caller's point of view, from any other "file exists but could not be
 * fetched" failure that `readLocalDocumentFileForImport` already propagates
 * (see its own comment) — `uploadUnsyncedRecords` catches it, the record
 * lands in `failedIds`, and the existing upload-failed banner (with its
 * existing retry button) reports it instead of a false "synced".
 */
export class DocumentTooLargeForSyncError extends Error {
  constructor(readonly sizeBytes: number) {
    super(
      `Local file is ${sizeBytes} bytes, larger than the server's ${MAX_DOCUMENT_BYTES}-byte limit, and cannot be synced.`,
    );
    this.name = 'DocumentTooLargeForSyncError';
  }
}

/**
 * Turns a Blob into the `{ mediaType, content }` shape the import endpoint
 * accepts. Throws `DocumentTooLargeForSyncError` when the blob is larger
 * than the server will ever accept in one request — see that class's own
 * comment for why this is no longer a silent metadata-only fallback.
 */
async function blobToImportFile(blob: Blob): Promise<{ mediaType: string; content: string }> {
  if (blob.size > MAX_DOCUMENT_BYTES) throw new DocumentTooLargeForSyncError(blob.size);
  return { mediaType: blob.type, content: toBase64(new Uint8Array(await blob.arrayBuffer())) };
}

/**
 * Resolves the actual file bytes for a local document being imported into
 * the canonical case-documents table, trying every place this codebase might
 * have put them (design decision #1 of the legacy-upload file cutover):
 *
 *  1. This browser's IndexedDB cache — covers any document whose file was
 *     saved while not on a `/clients/:clientId` route (see `saveDocumentFile`
 *     above), which is the common case for documents added before a case
 *     existed to scope them to.
 *  2. Server-side "workspace file" storage — covers a document saved while
 *     signed in *and* on a `/clients/:clientId` route, which never touches
 *     IndexedDB at all (`saveDocumentFile`'s other branch). Only reachable
 *     when the caller can supply the legacy client id (the workspace file API
 *     is scoped by it) and the browser is signed in; neither is available
 *     otherwise, so there is nothing to look up.
 *
 * Absent (both return nothing) is the normal case for a document nobody ever
 * attached a scan to — not an error, and not distinguished from "we looked
 * and found nothing" in the return value, exactly like `parseDataUrl`'s
 * `null` for the inline case this function is meant to sit alongside.
 *
 * A *genuine* fetch failure while retrieving bytes that are known to exist
 * (the workspace lookup found a URL but the network request for it failed)
 * is different: it is not "no file", it is "could not get the file right
 * now", so it is thrown rather than swallowed — the caller's importOne then
 * fails visibly and is retryable (see legacy-upload.ts), instead of quietly
 * importing the metadata alone and leaving the family to discover later that
 * the scan never made it.
 */
export async function readLocalDocumentFileForImport(
  id: string,
  legacyClientId: string | null,
): Promise<{ mediaType: string; content: string } | null> {
  const cachedBlob = await readIndexedDbBlob(id);
  if (cachedBlob) return blobToImportFile(cachedBlob);

  if (!legacyClientId || !getBrowserAuthClient()) return null;

  let url: string;
  try {
    url = (await getWorkspaceFileUrl(legacyClientId, id)).url;
  } catch (error) {
    // 404 means this id simply has no workspace file — normal, not an error
    // (see the function comment). Anything else (network down, 401/403 from
    // an expired session, a 5xx) is a real failure and must surface.
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`workspace-file-fetch-failed-${response.status}`);
  }
  return blobToImportFile(await response.blob());
}

export async function deleteDocumentFile(id: string): Promise<void> {
  const clientId = workspaceClientId();
  if (getBrowserAuthClient() && clientId) {
    await deleteWorkspaceFile(clientId, id);
    return;
  }
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('indexed-db-delete-failed'));
    });
  } finally {
    database.close();
  }
}

/**
 * WEB-17: `onblocked` used to resolve as if the delete had succeeded. When a
 * second tab holds the database open — the ordinary case on a phone with the
 * app open twice — the account-switch and sign-out paths therefore reported
 * success while the previous account's passport and ID scans stayed on disk
 * under the next account's session. A blocked delete is a failed delete, and
 * the caller has to be able to tell the difference.
 */
export class DocumentCacheClearError extends Error {
  constructor(readonly reason: 'blocked' | 'error') {
    super(`Local document cache could not be cleared (${reason}).`);
    this.name = 'DocumentCacheClearError';
  }
}

export async function clearLocalDocumentFileCache(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new DocumentCacheClearError('error'));
    request.onblocked = () => reject(new DocumentCacheClearError('blocked'));
  });
}

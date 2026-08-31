import { getBrowserAuthClient } from '../auth/client.js';
import { deleteWorkspaceFile, getWorkspaceFileUrl, uploadWorkspaceFile } from '../api/client.js';
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

function requireClientId(): string {
  const clientId = clientIdFromPath();
  if (!clientId) throw new Error('workspace-client-id-required');
  return clientId;
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
  if (getBrowserAuthClient()) {
    await uploadWorkspaceFile(requireClientId(), id, {
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

export async function readDocumentFile(id: string): Promise<Blob | string | null> {
  if (getBrowserAuthClient()) {
    return (await getWorkspaceFileUrl(requireClientId(), id)).url;
  }
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

export async function deleteDocumentFile(id: string): Promise<void> {
  if (getBrowserAuthClient()) {
    await deleteWorkspaceFile(requireClientId(), id);
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

import { ApiRequestError, getWorkspace, saveWorkspace } from '../api/client.js';
import {
  captureMvpWorkspace,
  clearMvpWorkspace,
  MVP_PROFILE_CHANGED,
  replaceMvpWorkspace,
} from './mvp-storage.js';
import { clearLocalDocumentFileCache } from './document-file-store.js';
import { clearBusinessStorageKey } from './business-storage-crypto.js';

export type WorkspaceSyncState = 'disabled' | 'loading' | 'saved' | 'saving' | 'error';
export const WORKSPACE_SYNC_CHANGED = 'caredesk:workspace-sync-changed';

let state: WorkspaceSyncState = 'disabled';
let remoteVersion = 0;
let remoteFingerprint = '';
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;
let flushInFlight: Promise<void> | undefined;
let flushQueued = false;

function fingerprint(snapshot: ReturnType<typeof captureMvpWorkspace>): string {
  return JSON.stringify(
    Object.entries(snapshot.entries).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function setState(next: WorkspaceSyncState): void {
  state = next;
  window.dispatchEvent(new CustomEvent(WORKSPACE_SYNC_CHANGED));
}

export function getWorkspaceSyncState(): WorkspaceSyncState {
  return state;
}

async function persistSnapshot(): Promise<void> {
  setState('saving');
  const snapshot = captureMvpWorkspace();
  try {
    const response = await saveWorkspace({
      expectedVersion: remoteVersion,
      snapshot,
    });
    remoteVersion = response.version;
    remoteFingerprint = fingerprint(response.snapshot);
    setState('saved');
  } catch (error) {
    // A stale tab must never overwrite a newer server version. The visible
    // error indicator tells the user to reload instead of pretending it saved.
    if (error instanceof ApiRequestError && error.code === 'VERSION_CONFLICT') {
      try {
        const latest = await getWorkspace();
        // A deployment can briefly return an older version from one instance
        // and reject the following write on another. Retry only when the
        // server payload itself is unchanged; a real edit from another device
        // must remain a visible conflict and must never be overwritten.
        if (fingerprint(latest.snapshot) !== remoteFingerprint) {
          setState('error');
          return;
        }
        const retried = await saveWorkspace({
          expectedVersion: latest.version,
          snapshot,
        });
        remoteVersion = retried.version;
        remoteFingerprint = fingerprint(retried.snapshot);
        setState('saved');
        return;
      } catch {
        setState('error');
        return;
      }
    }
    setState('error');
  }
}

function flush(): Promise<void> {
  if (flushInFlight) {
    flushQueued = true;
    return flushInFlight;
  }
  flushInFlight = persistSnapshot().finally(() => {
    flushInFlight = undefined;
    if (flushQueued && listening) {
      flushQueued = false;
      void flush();
    }
  });
  return flushInFlight;
}

function scheduleFlush(): void {
  if (!listening) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), 250);
}

/**
 * Retries the current local snapshot without reloading or rehydrating it.
 * This is deliberately separate from startWorkspaceSync(): after a transient
 * network or deployment failure, rehydrating first could discard edits that
 * have not reached the server yet.
 */
export function retryWorkspaceSync(): Promise<void> {
  if (!listening) return Promise.resolve();
  if (timer) clearTimeout(timer);
  timer = undefined;
  return flush();
}

export async function startWorkspaceSync(): Promise<void> {
  stopWorkspaceSync();
  setState('loading');
  // Clear first: data cached by a previous account must never appear while a
  // new account is being hydrated.
  clearMvpWorkspace();
  await clearLocalDocumentFileCache();
  const response = await getWorkspace();
  remoteVersion = response.version;
  remoteFingerprint = fingerprint(response.snapshot);
  replaceMvpWorkspace(response.snapshot);
  listening = true;
  window.addEventListener(MVP_PROFILE_CHANGED, scheduleFlush);
  setState('saved');
}

export function stopWorkspaceSync(): void {
  listening = false;
  window.removeEventListener(MVP_PROFILE_CHANGED, scheduleFlush);
  if (timer) clearTimeout(timer);
  timer = undefined;
  remoteVersion = 0;
  remoteFingerprint = '';
  flushQueued = false;
  clearMvpWorkspace();
  clearBusinessStorageKey();
  void clearLocalDocumentFileCache();
  setState('disabled');
}

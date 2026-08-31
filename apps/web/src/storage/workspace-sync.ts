import { ApiRequestError, getWorkspace, saveWorkspace } from '../api/client.js';
import {
  captureMvpWorkspace,
  clearMvpWorkspace,
  MVP_PROFILE_CHANGED,
  replaceMvpWorkspace,
  type MvpWorkspaceCapture,
  type MvpWorkspaceSnapshot,
} from './mvp-storage.js';
import { clearLocalDocumentFileCache } from './document-file-store.js';
import { clearAllFormDrafts } from './form-draft-store.js';
import { clearBusinessStorageKey } from './business-storage-crypto.js';

export type WorkspaceSyncState = 'disabled' | 'loading' | 'saved' | 'saving' | 'error';
export const WORKSPACE_SYNC_CHANGED = 'caredesk:workspace-sync-changed';

const WORKSPACE_OWNER_KEY = 'caredesk.workspace-owner.v1';
const WORKSPACE_META_PREFIX = 'caredesk.workspace-sync.v1.';

interface WorkspaceSyncMeta {
  version: number;
  dirty: boolean;
}

let state: WorkspaceSyncState = 'disabled';
let remoteVersion = 0;
let remoteFingerprint = '';
let activeUserId = '';
let syncGeneration = 0;
let dirty = false;
let applyingRemote = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;
let hydrationInFlight: Promise<void> | undefined;
let flushInFlight: Promise<void> | undefined;
let flushQueued = false;
/**
 * True only once this session has actually read the account's workspace from
 * the server. Until then an empty local cache means "we do not know yet", not
 * "the customer has no data" - see the guard in persistSnapshot.
 */
let hydratedThisSession = false;

function fingerprint(snapshot: MvpWorkspaceSnapshot): string {
  return JSON.stringify(
    Object.entries(snapshot.entries).sort(([left], [right]) => left.localeCompare(right)),
  );
}

const EMPTY_FINGERPRINT = fingerprint({ schemaVersion: 1, entries: {} });

/**
 * Refuses to overwrite a non-empty server workspace with an empty local one
 * that we cannot account for.
 *
 * startWorkspaceSync clears the local cache before the server responds, so
 * between that clear and a successful hydration the device holds nothing. If
 * hydration fails there - a network blip, an expired token, a cold API - the
 * device is empty for reasons that have nothing to do with the customer's
 * data. Persisting that state would destroy the real workspace on the server,
 * and the optimistic version check would not catch it because the version is
 * exactly the one this tab last saw.
 *
 * Deleting every client on purpose is still allowed: that path runs after a
 * successful hydration, so hydratedThisSession is true and the save proceeds.
 *
 * The rule deliberately does not consult remoteFingerprint. On the failure
 * path that fingerprint is still the empty string - we never got a response -
 * so testing it would make this guard unreachable. "We have not read the
 * server yet" is the whole signal, and an empty PUT is the whole risk.
 */
function wouldDestroyRemoteData(capture: MvpWorkspaceCapture): boolean {
  // Checked before hydration matters, because it is not a question about the
  // server at all. Some keys on this device cannot be decrypted, so whatever
  // we are holding is an incomplete picture of the customer's data, and
  // uploading it would delete every key we failed to read. There is no state
  // of the server that makes that acceptable.
  if (capture.unreadableKeys > 0) return true;
  if (hydratedThisSession) return false;
  return fingerprint(capture) === EMPTY_FINGERPRINT;
}

function metaKey(userId: string): string {
  return `${WORKSPACE_META_PREFIX}${encodeURIComponent(userId)}`;
}

function readMeta(userId: string): WorkspaceSyncMeta {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(metaKey(userId)) ?? '{}',
    ) as Partial<WorkspaceSyncMeta>;
    return {
      version:
        Number.isInteger(parsed.version) && (parsed.version ?? -1) >= 0 ? parsed.version! : 0,
      dirty: parsed.dirty === true,
    };
  } catch {
    return { version: 0, dirty: false };
  }
}

function writeMeta(): void {
  if (!activeUserId) return;
  window.localStorage.setItem(
    metaKey(activeUserId),
    JSON.stringify({ version: remoteVersion, dirty }),
  );
}

function localWorkspaceIsReadable(): boolean {
  // A stored value that is legitimately the empty string used to be
  // indistinguishable from one that failed to decrypt. captureMvpWorkspace now
  // reports the failures directly, so this asks the only question that matters.
  return captureMvpWorkspace().unreadableKeys === 0;
}

/**
 * A matching owner marker allows the UI to use its encrypted device cache
 * while the server is checked in the background. Unknown or unreadable data
 * is never shown because it may belong to another account or encryption key.
 */
export function canUseCachedWorkspace(userId: string): boolean {
  return (
    Boolean(userId) &&
    window.localStorage.getItem(WORKSPACE_OWNER_KEY) === userId &&
    localWorkspaceIsReadable()
  );
}

function setState(next: WorkspaceSyncState): void {
  state = next;
  window.dispatchEvent(new CustomEvent(WORKSPACE_SYNC_CHANGED));
}

export function getWorkspaceSyncState(): WorkspaceSyncState {
  return state;
}

function isCurrentSync(userId: string, generation: number): boolean {
  return activeUserId === userId && syncGeneration === generation;
}

function markSaved(
  response: { version: number; snapshot: MvpWorkspaceSnapshot },
  savedSnapshot?: MvpWorkspaceSnapshot,
): void {
  remoteVersion = response.version;
  remoteFingerprint = fingerprint(response.snapshot);
  dirty = savedSnapshot ? fingerprint(captureMvpWorkspace()) !== fingerprint(savedSnapshot) : false;
  if (dirty) flushQueued = true;
  writeMeta();
  setState(dirty ? 'saving' : 'saved');
}

async function persistSnapshot(): Promise<void> {
  const userId = activeUserId;
  const generation = syncGeneration;
  setState('saving');
  const capture = captureMvpWorkspace();
  // Only the two fields the API contract defines are sent; unreadableKeys is a
  // local diagnostic and has no business crossing the wire.
  const snapshot: MvpWorkspaceSnapshot = {
    schemaVersion: capture.schemaVersion,
    entries: capture.entries,
  };
  if (wouldDestroyRemoteData(capture)) {
    // Keep the pending flag so a later successful hydration can reconcile,
    // and surface the error rather than silently wiping the account.
    dirty = true;
    writeMeta();
    setState('error');
    return;
  }
  try {
    const response = await saveWorkspace({
      expectedVersion: remoteVersion,
      snapshot,
    });
    if (!isCurrentSync(userId, generation)) return;
    markSaved(response, snapshot);
  } catch (error) {
    if (!isCurrentSync(userId, generation)) return;
    // A stale tab must never overwrite a newer server version. Retry only
    // when the server content is the same snapshot this tab last observed.
    if (error instanceof ApiRequestError && error.code === 'VERSION_CONFLICT') {
      try {
        const latest = await getWorkspace();
        if (!isCurrentSync(userId, generation)) return;
        if (fingerprint(latest.snapshot) !== remoteFingerprint) {
          dirty = true;
          writeMeta();
          setState('error');
          return;
        }
        const retried = await saveWorkspace({
          expectedVersion: latest.version,
          snapshot,
        });
        if (!isCurrentSync(userId, generation)) return;
        markSaved(retried, snapshot);
        return;
      } catch {
        if (!isCurrentSync(userId, generation)) return;
        dirty = true;
        writeMeta();
        setState('error');
        return;
      }
    }
    dirty = true;
    writeMeta();
    setState('error');
  }
}

function flush(): Promise<void> {
  if (hydrationInFlight) {
    flushQueued = true;
    return hydrationInFlight;
  }
  if (flushInFlight) {
    flushQueued = true;
    return flushInFlight;
  }
  const generation = syncGeneration;
  const trackedFlush = persistSnapshot().finally(() => {
    if (flushInFlight === trackedFlush) flushInFlight = undefined;
    if (generation === syncGeneration && flushQueued && listening) {
      flushQueued = false;
      void flush();
    }
  });
  flushInFlight = trackedFlush;
  return trackedFlush;
}

function scheduleFlush(): void {
  if (!listening || applyingRemote) return;
  dirty = true;
  writeMeta();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), 250);
}

/** Retries the current device snapshot without rehydrating over local edits. */
export function retryWorkspaceSync(): Promise<void> {
  if (!listening) return Promise.resolve();
  if (timer) clearTimeout(timer);
  timer = undefined;
  return flush();
}

/**
 * Persists every pending local edit before a lifecycle boundary such as
 * signing out or moving a mobile browser to the background.
 */
export async function flushWorkspaceSync(): Promise<boolean> {
  if (!listening) return state !== 'error';
  if (timer) clearTimeout(timer);
  timer = undefined;

  try {
    if (hydrationInFlight) await hydrationInFlight;
    if (flushInFlight) await flushInFlight;
    if (dirty) await flush();
    if (flushInFlight) await flushInFlight;
  } catch {
    return false;
  }

  return !dirty && state !== 'error';
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'hidden') void flushWorkspaceSync();
}

function detachWorkspaceSync(): void {
  // A detached session knows nothing about the server again, so the empty
  // workspace guard must re-arm for whatever session comes next.
  hydratedThisSession = false;
  listening = false;
  window.removeEventListener(MVP_PROFILE_CHANGED, scheduleFlush);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  if (timer) clearTimeout(timer);
  timer = undefined;
  flushQueued = false;
  hydrationInFlight = undefined;
  flushInFlight = undefined;
}

function applyRemoteSnapshot(snapshot: MvpWorkspaceSnapshot): void {
  applyingRemote = true;
  try {
    replaceMvpWorkspace(snapshot);
  } finally {
    applyingRemote = false;
  }
}

async function hydrateWorkspace(
  userId: string,
  generation: number,
  hasUsableCache: boolean,
): Promise<void> {
  const response = await getWorkspace();
  if (!isCurrentSync(userId, generation)) return;
  // The account's server state is now known, so an empty local workspace from
  // here on is a real customer decision rather than a failed load.
  hydratedThisSession = true;

  if (hasUsableCache && dirty) {
    // Preserve a snapshot that failed to save on a previous visit. It can be
    // retried only if the remote version has not moved in the meantime.
    if (response.version !== remoteVersion) {
      setState('error');
      throw new Error('WORKSPACE_VERSION_CONFLICT');
    }
    remoteFingerprint = fingerprint(response.snapshot);
    await persistSnapshot();
    if (!isCurrentSync(userId, generation)) return;
    if (state === 'error') throw new Error('WORKSPACE_SAVE_FAILED');
  } else {
    applyRemoteSnapshot(response.snapshot);
    markSaved(response);
  }

  if (isCurrentSync(userId, generation)) {
    window.localStorage.setItem(WORKSPACE_OWNER_KEY, userId);
  }
}

/**
 * Starts account-scoped synchronization. A valid same-user cache stays visible
 * during hydration; a different or unknown cache is cleared before any app UI
 * can render it and is replaced only after a successful server response.
 */
export async function startWorkspaceSync(userId: string): Promise<void> {
  detachWorkspaceSync();
  hydratedThisSession = false;
  const generation = ++syncGeneration;
  setState('loading');
  activeUserId = userId;

  const hasUsableCache = canUseCachedWorkspace(userId);
  if (hasUsableCache) {
    const meta = readMeta(userId);
    remoteVersion = meta.version;
    dirty = meta.dirty;
  } else {
    clearMvpWorkspace();
    // WEB-02: a draft belongs to the account that typed it.
    clearAllFormDrafts();
    // WEB-17: this is the account-SWITCH path — the previous account's
    // passport and ID scans must be gone before account B is signed in. A
    // rejection here is allowed to propagate: the caller treats it as a
    // storage failure, which is the correct outcome for "we could not remove
    // the other account's identity documents".
    await clearLocalDocumentFileCache();
    clearBusinessStorageKey();
    window.localStorage.removeItem(WORKSPACE_OWNER_KEY);
    remoteVersion = 0;
    remoteFingerprint = '';
    dirty = false;
  }

  listening = true;
  window.addEventListener(MVP_PROFILE_CHANGED, scheduleFlush);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  const hydration = hydrateWorkspace(userId, generation, hasUsableCache);
  hydrationInFlight = hydration;
  try {
    await hydration;
  } catch (error) {
    if (activeUserId === userId) setState('error');
    throw error;
  } finally {
    if (hydrationInFlight === hydration) hydrationInFlight = undefined;
    if (flushQueued && listening && activeUserId === userId) {
      flushQueued = false;
      void flush();
    }
  }
}

/**
 * Stops the active network session without deleting the same-user encrypted
 * cache. This is used for transient auth loss so a returning mobile session
 * cannot make a recently entered employer record appear to have vanished.
 */
export function pauseWorkspaceSync(): void {
  detachWorkspaceSync();
  syncGeneration += 1;
  activeUserId = '';
  remoteVersion = 0;
  remoteFingerprint = '';
  dirty = false;
  setState('disabled');
}

/** Clears account data on explicit sign-out; startWorkspaceSync never calls it. */
export function stopWorkspaceSync(): void {
  const previousUserId = activeUserId;
  detachWorkspaceSync();
  syncGeneration += 1;
  activeUserId = '';
  remoteVersion = 0;
  remoteFingerprint = '';
  dirty = false;
  clearMvpWorkspace();
  clearBusinessStorageKey();
  // WEB-02: drafts hold salary figures for the account being signed out.
  clearAllFormDrafts();
  // WEB-17: a blocked delete now rejects instead of silently reporting
  // success. Sign-out cannot be made to wait on another tab releasing the
  // database, so this is logged rather than thrown — but it is no longer
  // invisible, which is what made the leak undetectable.
  void clearLocalDocumentFileCache().catch((error: unknown) => {
    console.warn('[caredesk] Local document cache was not cleared on sign-out.', error);
  });
  window.localStorage.removeItem(WORKSPACE_OWNER_KEY);
  if (previousUserId) window.localStorage.removeItem(metaKey(previousUserId));
  setState('disabled');
}

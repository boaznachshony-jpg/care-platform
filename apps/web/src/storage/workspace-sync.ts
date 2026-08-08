import { ApiRequestError, getWorkspace, saveWorkspace } from '../api/client.js';
import {
  captureMvpWorkspace,
  clearMvpWorkspace,
  MVP_PROFILE_CHANGED,
  replaceMvpWorkspace,
  type MvpWorkspaceSnapshot,
} from './mvp-storage.js';
import { clearLocalDocumentFileCache } from './document-file-store.js';
import { clearBusinessStorageKey } from './business-storage-crypto.js';

export type WorkspaceSyncState = 'disabled' | 'loading' | 'saved' | 'saving' | 'error';
export const WORKSPACE_SYNC_CHANGED = 'caredesk:workspace-sync-changed';

const WORKSPACE_OWNER_KEY = 'caredesk.workspace-owner.v1';
const WORKSPACE_META_PREFIX = 'caredesk.workspace-sync.v1.';
const WORKSPACE_BACKUP_PREFIX = 'caredesk.workspace-backup.v1.';
const MVP_STORAGE_PREFIX = 'caredesk.mvp.';

interface WorkspaceSyncMeta {
  version: number;
  dirty: boolean;
  fingerprint: string;
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

function fingerprint(snapshot: MvpWorkspaceSnapshot): string {
  return JSON.stringify(
    Object.entries(snapshot.entries).sort(([left], [right]) => left.localeCompare(right)),
  );
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
      fingerprint: typeof parsed.fingerprint === 'string' ? parsed.fingerprint : '',
    };
  } catch {
    return { version: 0, dirty: false, fingerprint: '' };
  }
}

function writeMeta(): void {
  if (!activeUserId) return;
  window.localStorage.setItem(
    metaKey(activeUserId),
    JSON.stringify({ version: remoteVersion, dirty, fingerprint: remoteFingerprint }),
  );
}

function backupKey(userId: string): string {
  return `${WORKSPACE_BACKUP_PREFIX}${encodeURIComponent(userId)}`;
}

/** Keeps the previous encrypted-at-rest cache recoverable before hydration replaces it. */
function backupEncryptedWorkspace(userId: string): void {
  const entries = Object.fromEntries(
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(MVP_STORAGE_PREFIX))
      .map((key) => [key, window.localStorage.getItem(key)]),
  );
  if (Object.keys(entries).length > 0) {
    window.localStorage.setItem(
      backupKey(userId),
      JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), entries }),
    );
  }
}

interface EncryptedWorkspaceBackup {
  schemaVersion: 1;
  createdAt: string;
  entries: Record<string, string>;
}

function readEncryptedWorkspaceBackup(userId: string): EncryptedWorkspaceBackup | null {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(backupKey(userId)) ?? 'null',
    ) as Partial<EncryptedWorkspaceBackup> | null;
    if (
      parsed?.schemaVersion !== 1 ||
      typeof parsed.createdAt !== 'string' ||
      !parsed.entries ||
      Object.entries(parsed.entries).some(
        ([key, value]) => !key.startsWith(MVP_STORAGE_PREFIX) || typeof value !== 'string',
      )
    ) {
      return null;
    }
    return parsed as EncryptedWorkspaceBackup;
  } catch {
    return null;
  }
}

export function hasWorkspaceRecoverySnapshot(userId: string): boolean {
  return Boolean(userId) && readEncryptedWorkspaceBackup(userId) !== null;
}

/**
 * Incident-only recovery for the currently authenticated account. The current
 * encrypted cache becomes the new rollback snapshot before restoration.
 */
export function restoreWorkspaceRecoverySnapshot(userId: string): boolean {
  if (!userId || userId !== activeUserId) return false;
  const recovery = readEncryptedWorkspaceBackup(userId);
  if (!recovery) return false;
  backupEncryptedWorkspace(userId);
  applyingRemote = true;
  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(MVP_STORAGE_PREFIX))
      .forEach((key) => window.localStorage.removeItem(key));
    Object.entries(recovery.entries).forEach(([key, value]) =>
      window.localStorage.setItem(key, value),
    );
    dirty = true;
    writeMeta();
    window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));
    setState('error');
    return true;
  } finally {
    applyingRemote = false;
  }
}

function assertValidRemoteSnapshot(snapshot: MvpWorkspaceSnapshot): void {
  if (
    snapshot.schemaVersion !== 1 ||
    !snapshot.entries ||
    typeof snapshot.entries !== 'object' ||
    Object.entries(snapshot.entries).some(
      ([key, value]) => !key.startsWith(MVP_STORAGE_PREFIX) || typeof value !== 'string',
    )
  ) {
    throw new Error('WORKSPACE_SCHEMA_UNSUPPORTED');
  }
}

function localWorkspaceIsReadable(): boolean {
  const rawKeys = Object.keys(window.localStorage).filter((key) =>
    key.startsWith(MVP_STORAGE_PREFIX),
  );
  if (rawKeys.length === 0) return true;
  const entries = captureMvpWorkspace().entries;
  return rawKeys.every((key) => Object.hasOwn(entries, key) && entries[key] !== '');
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
  const snapshot = captureMvpWorkspace();
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
  if (activeUserId) backupEncryptedWorkspace(activeUserId);
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
  assertValidRemoteSnapshot(response.snapshot);

  const localSnapshot = captureMvpWorkspace();
  const localHasData = Object.keys(localSnapshot.entries).length > 0;
  const remoteHasData = Object.keys(response.snapshot.entries).length > 0;
  if (hasUsableCache && response.version < remoteVersion) {
    throw new Error('WORKSPACE_VERSION_ROLLBACK');
  }
  if (
    hasUsableCache &&
    localHasData &&
    (!remoteHasData ||
      (response.version === remoteVersion &&
        remoteFingerprint !== '' &&
        fingerprint(response.snapshot) !== remoteFingerprint))
  ) {
    dirty = true;
    writeMeta();
    throw new Error('WORKSPACE_SUSPICIOUS_REMOTE');
  }

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
  const generation = ++syncGeneration;
  setState('loading');
  activeUserId = userId;

  const hasUsableCache = canUseCachedWorkspace(userId);
  if (hasUsableCache) {
    const meta = readMeta(userId);
    remoteVersion = meta.version;
    dirty = meta.dirty;
    remoteFingerprint = meta.fingerprint;
  } else {
    clearMvpWorkspace();
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
  void clearLocalDocumentFileCache();
  window.localStorage.removeItem(WORKSPACE_OWNER_KEY);
  if (previousUserId) window.localStorage.removeItem(metaKey(previousUserId));
  setState('disabled');
}

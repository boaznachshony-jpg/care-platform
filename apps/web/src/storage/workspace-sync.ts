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

/**
 * - 'conflict': another device saved a newer version and this device holds
 *   edits of its own. Nothing is retried automatically; the customer chooses
 *   with resolveWorkspaceConflict.
 * - 'shrink-blocked': the server refused a save that would empty most of the
 *   workspace. The customer confirms or undoes with resolveWorkspaceShrink.
 * - 'read-only': the server refused the save (403) but still serves the
 *   workspace, so the local copy was re-aligned with the server. Viewer role.
 * - 'unauthorized': the server refuses to serve the workspace at all (401/403
 *   on GET). Access was revoked; the auth layer purges the device.
 */
export type WorkspaceSyncState =
  | 'disabled'
  | 'loading'
  | 'saved'
  | 'saving'
  | 'error'
  | 'conflict'
  | 'shrink-blocked'
  | 'read-only'
  | 'unauthorized';
export const WORKSPACE_SYNC_CHANGED = 'caredesk:workspace-sync-changed';

const WORKSPACE_OWNER_KEY = 'caredesk.workspace-owner.v1';
const WORKSPACE_META_PREFIX = 'caredesk.workspace-sync.v1.';
/**
 * Local residue that is written per account but never went through the
 * encrypted business cache: onboarding step markers and pending legal
 * acceptances, and the legacy-upload bookkeeping. They must not survive into
 * the next account's session on this device.
 */
const ACCOUNT_SCOPED_RESIDUE_PREFIXES = ['caredesk.onboarding.', 'caredesk.sync.'] as const;
/** An idle open tab re-checks its access at most this often. */
const REVALIDATE_AFTER_MS = 5 * 60_000;

interface WorkspaceSyncMeta {
  version: number;
  dirty: boolean;
}

interface RemoteWorkspace {
  version: number;
  snapshot: MvpWorkspaceSnapshot;
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
 * The server copy fetched when a save was refused ('conflict' or
 * 'shrink-blocked'). It is the "other side" of the choice the customer is
 * asked to make, and is dropped as soon as the choice is made.
 */
let pendingRemote: RemoteWorkspace | undefined;
/** One-shot permission for the next PUT, granted only by resolveWorkspaceShrink. */
let allowShrinkOnce = false;
let lastServerReadAt = 0;
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

/**
 * 401 or 403 from the workspace API. Unlike a network failure this cannot be
 * retried into success: the account is no longer allowed to do what it asked.
 */
export function isWorkspaceAccessDeniedError(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403);
}

/**
 * Removes per-account localStorage residue that lives outside the encrypted
 * business cache. Called on sign-out and when another account takes over the
 * device, never on a same-account resume.
 */
export function clearAccountScopedResidue(): void {
  if (typeof window === 'undefined') return;
  Object.keys(window.localStorage)
    .filter((key) => ACCOUNT_SCOPED_RESIDUE_PREFIXES.some((prefix) => key.startsWith(prefix)))
    .forEach((key) => window.localStorage.removeItem(key));
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

function markUnsaved(next: WorkspaceSyncState): void {
  dirty = true;
  writeMeta();
  setState(next);
}

function markSaved(response: RemoteWorkspace, savedSnapshot?: MvpWorkspaceSnapshot): void {
  remoteVersion = response.version;
  remoteFingerprint = fingerprint(response.snapshot);
  pendingRemote = undefined;
  lastServerReadAt = Date.now();
  dirty = savedSnapshot ? fingerprint(captureMvpWorkspace()) !== fingerprint(savedSnapshot) : false;
  if (dirty) flushQueued = true;
  writeMeta();
  setState(dirty ? 'saving' : 'saved');
}

function applyRemoteSnapshot(snapshot: MvpWorkspaceSnapshot): void {
  applyingRemote = true;
  try {
    replaceMvpWorkspace(snapshot);
  } finally {
    applyingRemote = false;
  }
}

/**
 * The server refused the save because the account is not allowed to write.
 * Retrying cannot help, so the pending flag is dropped. If the server still
 * serves the workspace the device is re-aligned with it and the customer is
 * told the edit did not land ('read-only'). If it does not, access is gone.
 */
async function handleAccessDenied(userId: string, generation: number): Promise<void> {
  dirty = false;
  writeMeta();
  try {
    const latest = await getWorkspace();
    if (!isCurrentSync(userId, generation)) return;
    applyRemoteSnapshot(latest.snapshot);
    remoteVersion = latest.version;
    remoteFingerprint = fingerprint(latest.snapshot);
    lastServerReadAt = Date.now();
    writeMeta();
    setState('read-only');
  } catch (error) {
    if (!isCurrentSync(userId, generation)) return;
    setState(isWorkspaceAccessDeniedError(error) ? 'unauthorized' : 'read-only');
  }
}

async function persistSnapshot(): Promise<void> {
  const userId = activeUserId;
  const generation = syncGeneration;
  setState('saving');
  const capture = captureMvpWorkspace();
  // Only the fields the API contract defines are sent; unreadableKeys is a
  // local diagnostic and has no business crossing the wire.
  const snapshot: MvpWorkspaceSnapshot = {
    schemaVersion: capture.schemaVersion,
    entries: capture.entries,
  };
  const allowShrink = allowShrinkOnce;
  allowShrinkOnce = false;
  if (wouldDestroyRemoteData(capture)) {
    // Keep the pending flag so a later successful hydration can reconcile,
    // and surface the error rather than silently wiping the account.
    markUnsaved('error');
    return;
  }
  try {
    const response = await saveWorkspace({
      expectedVersion: remoteVersion,
      snapshot,
      ...(allowShrink ? { allowShrink: true } : {}),
    });
    if (!isCurrentSync(userId, generation)) return;
    markSaved(response, snapshot);
  } catch (error) {
    if (!isCurrentSync(userId, generation)) return;
    if (isWorkspaceAccessDeniedError(error)) {
      await handleAccessDenied(userId, generation);
      return;
    }
    // A stale tab must never overwrite a newer server version. Retry only
    // when the server content is the same snapshot this tab last observed;
    // otherwise hand the decision to the customer instead of looping on a
    // retry that can never succeed.
    if (error instanceof ApiRequestError && error.code === 'VERSION_CONFLICT') {
      try {
        const latest = await getWorkspace();
        if (!isCurrentSync(userId, generation)) return;
        if (fingerprint(latest.snapshot) !== remoteFingerprint) {
          pendingRemote = { version: latest.version, snapshot: latest.snapshot };
          markUnsaved('conflict');
          return;
        }
        const retried = await saveWorkspace({
          expectedVersion: latest.version,
          snapshot,
          ...(allowShrink ? { allowShrink: true } : {}),
        });
        if (!isCurrentSync(userId, generation)) return;
        markSaved(retried, snapshot);
        return;
      } catch (retryError) {
        if (!isCurrentSync(userId, generation)) return;
        if (isWorkspaceAccessDeniedError(retryError)) {
          await handleAccessDenied(userId, generation);
          return;
        }
        markUnsaved('error');
        return;
      }
    }
    // The server refused to replace a populated workspace with a nearly empty
    // one. That is either the deletion the customer just confirmed on one
    // screen, or a bug about to erase their account - only they can tell.
    if (error instanceof ApiRequestError && error.code === 'WORKSPACE_SHRINK_REJECTED') {
      try {
        const latest = await getWorkspace();
        if (!isCurrentSync(userId, generation)) return;
        pendingRemote = { version: latest.version, snapshot: latest.snapshot };
        markUnsaved('shrink-blocked');
      } catch {
        if (!isCurrentSync(userId, generation)) return;
        markUnsaved('error');
      }
      return;
    }
    markUnsaved('error');
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
    if (generation === syncGeneration && flushQueued && listening && !awaitingCustomerChoice()) {
      flushQueued = false;
      void flush();
    }
  });
  flushInFlight = trackedFlush;
  return trackedFlush;
}

function awaitingCustomerChoice(): boolean {
  return state === 'conflict' || state === 'shrink-blocked';
}

function scheduleFlush(): void {
  if (!listening || applyingRemote) return;
  dirty = true;
  writeMeta();
  // While the customer is being asked which version to keep, a further local
  // edit must not start another save: it would hit the same refusal and
  // flicker the alert. The edit is captured when they decide.
  if (awaitingCustomerChoice()) return;
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
 * Resolves a cross-device version conflict.
 * - 'keep-remote': the server copy replaces the edits on this device.
 * - 'keep-local': this device's copy is saved over the server version. The
 *   server keeps the overwritten version in its history
 *   (database/migrations/0035_workspace_version_history.sql), so nothing is
 *   irrecoverable either way.
 */
export async function resolveWorkspaceConflict(
  choice: 'keep-remote' | 'keep-local',
): Promise<void> {
  if (!listening || state !== 'conflict' || !pendingRemote) return;
  const latest = pendingRemote;
  if (choice === 'keep-remote') {
    applyRemoteSnapshot(latest.snapshot);
    markSaved(latest);
    return;
  }
  remoteVersion = latest.version;
  remoteFingerprint = fingerprint(latest.snapshot);
  pendingRemote = undefined;
  if (timer) clearTimeout(timer);
  timer = undefined;
  await flush();
}

/**
 * Resolves a save the server refused as destructive.
 * - 'confirm': the shrink is re-sent with explicit permission.
 * - 'undo': the server copy is restored on this device.
 */
export async function resolveWorkspaceShrink(choice: 'confirm' | 'undo'): Promise<void> {
  if (!listening || state !== 'shrink-blocked' || !pendingRemote) return;
  const latest = pendingRemote;
  if (choice === 'undo') {
    applyRemoteSnapshot(latest.snapshot);
    markSaved(latest);
    return;
  }
  remoteVersion = latest.version;
  remoteFingerprint = fingerprint(latest.snapshot);
  pendingRemote = undefined;
  allowShrinkOnce = true;
  if (timer) clearTimeout(timer);
  timer = undefined;
  await flush();
}

/**
 * Persists every pending local edit before a lifecycle boundary such as
 * signing out or moving a mobile browser to the background. Resolves true
 * when nothing is left unsaved - a previous failure whose edits were since
 * saved does not count against the customer.
 */
export async function flushWorkspaceSync(): Promise<boolean> {
  if (!listening) return !dirty;
  if (timer) clearTimeout(timer);
  timer = undefined;
  // A refused save needs a decision, not another attempt.
  if (awaitingCustomerChoice()) return false;

  try {
    if (hydrationInFlight) await hydrationInFlight;
    if (flushInFlight) await flushInFlight;
    if (dirty && !awaitingCustomerChoice()) await flush();
    if (flushInFlight) await flushInFlight;
  } catch {
    return false;
  }

  return !dirty;
}

/**
 * An idle tab that was open when access was revoked would otherwise keep a
 * browsable copy forever. When it comes back to the foreground after a while
 * and holds nothing unsaved, the workspace is re-read: a refusal surfaces as
 * 'unauthorized', and a newer server version is simply applied.
 */
async function revalidateWorkspace(): Promise<void> {
  const userId = activeUserId;
  const generation = syncGeneration;
  try {
    const latest = await getWorkspace();
    if (!isCurrentSync(userId, generation) || dirty || !listening) return;
    lastServerReadAt = Date.now();
    if (latest.version !== remoteVersion) {
      applyRemoteSnapshot(latest.snapshot);
      markSaved(latest);
    }
  } catch (error) {
    if (!isCurrentSync(userId, generation)) return;
    if (isWorkspaceAccessDeniedError(error)) setState('unauthorized');
  }
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    void flushWorkspaceSync();
    return;
  }
  if (
    document.visibilityState === 'visible' &&
    state === 'saved' &&
    !dirty &&
    Date.now() - lastServerReadAt > REVALIDATE_AFTER_MS
  ) {
    void revalidateWorkspace();
  }
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
  pendingRemote = undefined;
  allowShrinkOnce = false;
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
  lastServerReadAt = Date.now();

  if (hasUsableCache && dirty) {
    // Preserve a snapshot that failed to save on a previous visit. It can be
    // retried only if the remote version has not moved in the meantime;
    // otherwise the customer chooses, exactly as for a live conflict.
    if (response.version !== remoteVersion) {
      pendingRemote = { version: response.version, snapshot: response.snapshot };
      markUnsaved('conflict');
    } else {
      remoteFingerprint = fingerprint(response.snapshot);
      await persistSnapshot();
      if (!isCurrentSync(userId, generation)) return;
      if (state === 'error') throw new Error('WORKSPACE_SAVE_FAILED');
    }
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
    // Two very different situations end up here. Another account (or no
    // account) owned this device: everything it left behind must go before
    // the new account is signed in. Or the SAME account is back but its
    // encrypted cache cannot be read - the cache key lives in sessionStorage
    // and died with the browser. The unreadable business cache is useless
    // either way and is cleared; the passport scans, drafts and cache key
    // belong to the same customer and are kept.
    const sameOwner = window.localStorage.getItem(WORKSPACE_OWNER_KEY) === userId;
    clearMvpWorkspace();
    if (!sameOwner) {
      // WEB-02: a draft belongs to the account that typed it.
      clearAllFormDrafts();
      // WEB-17: this is the account-SWITCH path — the previous account's
      // passport and ID scans must be gone before account B is signed in. A
      // rejection here is allowed to propagate: the caller treats it as a
      // storage failure, which is the correct outcome for "we could not remove
      // the other account's identity documents".
      await clearLocalDocumentFileCache();
      clearBusinessStorageKey();
      clearAccountScopedResidue();
    }
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
    if (activeUserId === userId) {
      setState(isWorkspaceAccessDeniedError(error) ? 'unauthorized' : 'error');
    }
    throw error;
  } finally {
    if (hydrationInFlight === hydration) hydrationInFlight = undefined;
    if (flushQueued && listening && activeUserId === userId && !awaitingCustomerChoice()) {
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

export interface StopWorkspaceSyncResult {
  /**
   * False when the plaintext IndexedDB document cache could not be deleted -
   * typically another CareDesk tab still holds the database open. Every
   * localStorage clear has already happened by then; only the files remain.
   */
  documentCacheCleared: boolean;
}

/** Clears account data on explicit sign-out; startWorkspaceSync never calls it. */
export async function stopWorkspaceSync(): Promise<StopWorkspaceSyncResult> {
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
  clearAccountScopedResidue();
  window.localStorage.removeItem(WORKSPACE_OWNER_KEY);
  if (previousUserId) window.localStorage.removeItem(metaKey(previousUserId));
  setState('disabled');
  // WEB-17 / SEC-WEB-02: a blocked delete rejects instead of silently
  // reporting success, and the caller is told, so the customer can be shown
  // that files are still on the device instead of a clean sign-out.
  try {
    await clearLocalDocumentFileCache();
    return { documentCacheCleared: true };
  } catch (error) {
    console.warn('[caredesk] Local document cache was not cleared on sign-out.', error);
    return { documentCacheCleared: false };
  }
}

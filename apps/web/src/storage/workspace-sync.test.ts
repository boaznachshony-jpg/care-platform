import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class MockApiRequestError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
    ) {
      super(code);
    }
  }
  class MockDocumentCacheClearError extends Error {
    constructor(readonly reason: string) {
      super(reason);
    }
  }
  return {
    ApiRequestError: MockApiRequestError,
    DocumentCacheClearError: MockDocumentCacheClearError,
    getWorkspace: vi.fn(),
    saveWorkspace: vi.fn(),
    clearLocalDocumentFileCache: vi.fn(),
  };
});

vi.mock('../api/client.js', () => ({
  ApiRequestError: mocks.ApiRequestError,
  getWorkspace: mocks.getWorkspace,
  saveWorkspace: mocks.saveWorkspace,
}));

vi.mock('./document-file-store.js', () => ({
  DocumentCacheClearError: mocks.DocumentCacheClearError,
  clearLocalDocumentFileCache: mocks.clearLocalDocumentFileCache,
}));

import { captureMvpWorkspace, MVP_PROFILE_CHANGED } from './mvp-storage.js';
import {
  clearAccountScopedResidue,
  flushWorkspaceSync,
  getWorkspaceSyncState,
  isWorkspaceAccessDeniedError,
  pauseWorkspaceSync,
  resolveWorkspaceConflict,
  resolveWorkspaceShrink,
  retryWorkspaceSync,
  startWorkspaceSync,
  stopWorkspaceSync,
} from './workspace-sync.js';

const OWNER_KEY = 'caredesk.workspace-owner.v1';
const META_KEY = 'caredesk.workspace-sync.v1.user-a';
/** Stored by an earlier session, under a key this session does not have. */
const CIPHERTEXT_FROM_A_DEAD_SESSION =
  'caredesk-encrypted-v1:0102030405060708090a0b0c:deadbeefdeadbeefdeadbeef';

const REMOTE_ENTRIES = { 'caredesk.mvp.clients.v1': '[{"id":"remote"}]' };
const CHANGED_ELSEWHERE = { 'caredesk.mvp.clients.v1': '[{"id":"changed-elsewhere"}]' };

function remote(version: number, entries: Record<string, string> = REMOTE_ENTRIES) {
  return { version, snapshot: { schemaVersion: 1 as const, entries }, updatedAt: '' };
}

/** Edits locally and lets the 250 ms debounce fire. */
async function editLocally(key: string, value: string) {
  localStorage.setItem(key, value);
  window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));
  await vi.advanceTimersByTimeAsync(300);
}

/** A save refused because another device moved the version and changed content. */
async function reachDivergentConflict() {
  await startWorkspaceSync('user-a');
  mocks.saveWorkspace.mockRejectedValueOnce(new mocks.ApiRequestError(409, 'VERSION_CONFLICT'));
  mocks.getWorkspace.mockResolvedValueOnce(remote(5, CHANGED_ELSEWHERE));
  await editLocally('caredesk.mvp.tasks.v1.client.remote', '[{"id":"mine"}]');
}

describe('workspace sync', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    mocks.getWorkspace.mockReset();
    mocks.saveWorkspace.mockReset();
    mocks.clearLocalDocumentFileCache.mockReset();
    mocks.clearLocalDocumentFileCache.mockResolvedValue(undefined);
    mocks.getWorkspace.mockResolvedValue({
      version: 4,
      snapshot: {
        schemaVersion: 1,
        entries: { 'caredesk.mvp.clients.v1': '[{"id":"remote"}]' },
      },
      updatedAt: new Date().toISOString(),
    });
    mocks.saveWorkspace.mockImplementation(async ({ snapshot }) => ({
      version: 5,
      snapshot,
      updatedAt: '',
    }));
  });

  afterEach(async () => {
    await stopWorkspaceSync();
    vi.useRealTimers();
  });

  it('clears another account cache and hydrates the authenticated workspace', async () => {
    localStorage.setItem('caredesk.mvp.clients.v1', '[{"id":"old-account"}]');
    localStorage.setItem('caredesk.ui.font-scale.v1', '1.3');

    await startWorkspaceSync('user-a');

    expect(captureMvpWorkspace().entries['caredesk.mvp.clients.v1']).toBe('[{"id":"remote"}]');
    // Device-only accessibility preferences are intentionally not server data.
    expect(localStorage.getItem('caredesk.ui.font-scale.v1')).toBe('1.3');
  });

  it('never uploads an empty workspace when the account was never read from the server', async () => {
    // startWorkspaceSync clears an unrecognised local cache before the server
    // answers. If that answer never arrives, the device is empty for reasons
    // that have nothing to do with the customer's data - and uploading it
    // would destroy the real workspace held on the server.
    localStorage.setItem('caredesk.mvp.clients.v1', '[{"id":"unrecognised-cache"}]');
    mocks.getWorkspace.mockRejectedValue(new Error('NETWORK_DOWN'));

    await expect(startWorkspaceSync('user-a')).rejects.toThrow();
    expect(captureMvpWorkspace().entries['caredesk.mvp.clients.v1']).toBeUndefined();

    window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.saveWorkspace).not.toHaveBeenCalled();
    expect(getWorkspaceSyncState()).toBe('error');
  });

  it('still saves a deliberate deletion once the server state is known', async () => {
    await startWorkspaceSync('user-a');
    // Hydration succeeded, so an empty workspace now reflects a real choice.
    localStorage.removeItem('caredesk.mvp.clients.v1');
    window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));

    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.saveWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot: expect.objectContaining({ entries: {} }) }),
    );
  });

  it('persists changes with optimistic concurrency', async () => {
    await startWorkspaceSync('user-a');
    localStorage.setItem('caredesk.mvp.tasks.v1.client.remote', '[]');
    window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));

    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.saveWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 4,
        snapshot: expect.objectContaining({
          entries: expect.objectContaining({
            'caredesk.mvp.tasks.v1.client.remote': '[]',
          }),
        }),
      }),
    );
  });

  it('flushes a pending employer edit before the debounce timer expires', async () => {
    await startWorkspaceSync('user-a');
    localStorage.setItem('caredesk.mvp.tasks.v1.client.remote', '[{"id":"just-entered"}]');
    window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));

    expect(mocks.saveWorkspace).not.toHaveBeenCalled();
    await expect(flushWorkspaceSync()).resolves.toBe(true);

    expect(mocks.saveWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          entries: expect.objectContaining({
            'caredesk.mvp.tasks.v1.client.remote': '[{"id":"just-entered"}]',
          }),
        }),
      }),
    );
  });

  it('preserves the encrypted same-user cache on a transient auth pause', async () => {
    await startWorkspaceSync('user-a');
    localStorage.setItem('caredesk.mvp.tasks.v1.client.remote', '[{"id":"still-here"}]');
    window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));

    pauseWorkspaceSync();

    expect(captureMvpWorkspace().entries['caredesk.mvp.tasks.v1.client.remote']).toBe(
      '[{"id":"still-here"}]',
    );
  });

  it('recovers a deployment-time version conflict when the remote content is unchanged', async () => {
    await startWorkspaceSync('user-a');
    mocks.saveWorkspace
      .mockRejectedValueOnce(new mocks.ApiRequestError(409, 'VERSION_CONFLICT'))
      .mockImplementationOnce(async ({ snapshot }) => ({
        version: 6,
        snapshot,
        updatedAt: '',
      }));
    mocks.getWorkspace.mockResolvedValueOnce({
      version: 5,
      snapshot: {
        schemaVersion: 1,
        entries: { 'caredesk.mvp.clients.v1': '[{"id":"remote"}]' },
      },
      updatedAt: '',
    });

    localStorage.setItem('caredesk.mvp.tasks.v1.client.remote', '[]');
    window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.saveWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedVersion: 5 }),
    );
  });

  it('does not overwrite a real remote edit after a version conflict', async () => {
    await startWorkspaceSync('user-a');
    mocks.saveWorkspace.mockRejectedValueOnce(new mocks.ApiRequestError(409, 'VERSION_CONFLICT'));
    mocks.getWorkspace.mockResolvedValueOnce({
      version: 5,
      snapshot: {
        schemaVersion: 1,
        entries: { 'caredesk.mvp.clients.v1': '[{"id":"changed-elsewhere"}]' },
      },
      updatedAt: '',
    });

    localStorage.setItem('caredesk.mvp.tasks.v1.client.remote', '[]');
    window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.saveWorkspace).toHaveBeenCalledTimes(1);
  });

  it('retries the current local snapshot after a transient save failure', async () => {
    await startWorkspaceSync('user-a');
    mocks.saveWorkspace
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockImplementationOnce(async ({ snapshot }) => ({
        version: 5,
        snapshot,
        updatedAt: '',
      }));

    localStorage.setItem('caredesk.mvp.tasks.v1.client.remote', '[{"id":"unsaved"}]');
    window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));
    await vi.advanceTimersByTimeAsync(300);

    expect(getWorkspaceSyncState()).toBe('error');

    await retryWorkspaceSync();

    expect(mocks.saveWorkspace).toHaveBeenCalledTimes(2);
    expect(mocks.saveWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedVersion: 4,
        snapshot: expect.objectContaining({
          entries: expect.objectContaining({
            'caredesk.mvp.tasks.v1.client.remote': '[{"id":"unsaved"}]',
          }),
        }),
      }),
    );
    expect(getWorkspaceSyncState()).toBe('saved');
  });

  it('keeps a valid same-user cache when remote hydration fails', async () => {
    await startWorkspaceSync('user-a');
    localStorage.setItem('caredesk.mvp.tasks.v1.client.remote', '[{"id":"local-task"}]');
    window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));
    await vi.advanceTimersByTimeAsync(300);

    mocks.getWorkspace.mockRejectedValueOnce(new TypeError('network unavailable'));

    await expect(startWorkspaceSync('user-a')).rejects.toThrow('network unavailable');

    expect(captureMvpWorkspace().entries['caredesk.mvp.tasks.v1.client.remote']).toBe(
      '[{"id":"local-task"}]',
    );
    expect(getWorkspaceSyncState()).toBe('error');
  });

  it('retries an unsaved same-user snapshot on the next hydration', async () => {
    await startWorkspaceSync('user-a');
    mocks.saveWorkspace
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockImplementationOnce(async ({ snapshot }) => ({
        version: 5,
        snapshot,
        updatedAt: '',
      }));

    localStorage.setItem('caredesk.mvp.tasks.v1.client.remote', '[{"id":"pending"}]');
    window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));
    await vi.advanceTimersByTimeAsync(300);
    expect(getWorkspaceSyncState()).toBe('error');

    await startWorkspaceSync('user-a');

    expect(mocks.saveWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedVersion: 4,
        snapshot: expect.objectContaining({
          entries: expect.objectContaining({
            'caredesk.mvp.tasks.v1.client.remote': '[{"id":"pending"}]',
          }),
        }),
      }),
    );
    expect(getWorkspaceSyncState()).toBe('saved');
  });

  it('clears a previous account cache before hydrating another account', async () => {
    await startWorkspaceSync('user-a');
    localStorage.setItem('caredesk.mvp.tasks.v1.client.remote', '[{"id":"private-a"}]');

    let resolveWorkspace!: (value: Awaited<ReturnType<typeof mocks.getWorkspace>>) => void;
    mocks.getWorkspace.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveWorkspace = resolve;
        }),
    );

    const hydration = startWorkspaceSync('user-b');
    await Promise.resolve();

    expect(captureMvpWorkspace().entries).toEqual({});

    resolveWorkspace({
      version: 1,
      snapshot: {
        schemaVersion: 1,
        entries: { 'caredesk.mvp.clients.v1': '[{"id":"user-b"}]' },
      },
      updatedAt: '',
    });
    await hydration;

    expect(captureMvpWorkspace().entries['caredesk.mvp.clients.v1']).toBe('[{"id":"user-b"}]');
  });
});

/**
 * UI-WRITE-01. A version conflict against changed remote content used to land
 * in 'error' with a retry button, and the retry re-sent the same stale
 * expectedVersion - a loop that could never end. Save, reload and sign-out all
 * failed. The customer now chooses which side wins.
 */
describe('workspace sync: cross-device conflict', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    mocks.getWorkspace.mockReset().mockResolvedValue(remote(4));
    mocks.saveWorkspace
      .mockReset()
      .mockImplementation(async ({ snapshot }) => ({ version: 5, snapshot, updatedAt: '' }));
    mocks.clearLocalDocumentFileCache.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await stopWorkspaceSync();
    vi.useRealTimers();
  });

  it('enters a distinct conflict state instead of a retry that can never succeed', async () => {
    await reachDivergentConflict();

    expect(getWorkspaceSyncState()).toBe('conflict');
    expect(mocks.saveWorkspace).toHaveBeenCalledTimes(1);
    // The refusal is not a reason to lose the edit: it is still marked pending.
    expect(JSON.parse(localStorage.getItem(META_KEY) ?? '{}')).toMatchObject({ dirty: true });
  });

  it('does not keep re-sending while the customer is deciding', async () => {
    await reachDivergentConflict();

    await editLocally('caredesk.mvp.tasks.v1.client.remote', '[{"id":"mine-again"}]');

    expect(mocks.saveWorkspace).toHaveBeenCalledTimes(1);
    expect(getWorkspaceSyncState()).toBe('conflict');
  });

  it('keep-remote replaces the local edits with the server copy and settles as saved', async () => {
    await reachDivergentConflict();

    await resolveWorkspaceConflict('keep-remote');

    expect(captureMvpWorkspace().entries).toEqual(CHANGED_ELSEWHERE);
    expect(getWorkspaceSyncState()).toBe('saved');
    expect(mocks.saveWorkspace).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(META_KEY) ?? '{}')).toEqual({
      version: 5,
      dirty: false,
    });
  });

  it('keep-local saves this device over the newer server version', async () => {
    await reachDivergentConflict();
    mocks.saveWorkspace.mockImplementationOnce(async ({ snapshot }) => ({
      version: 6,
      snapshot,
      updatedAt: '',
    }));

    await resolveWorkspaceConflict('keep-local');

    expect(mocks.saveWorkspace).toHaveBeenCalledTimes(2);
    expect(mocks.saveWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedVersion: 5,
        snapshot: expect.objectContaining({
          entries: expect.objectContaining({
            'caredesk.mvp.tasks.v1.client.remote': '[{"id":"mine"}]',
          }),
        }),
      }),
    );
    expect(getWorkspaceSyncState()).toBe('saved');
  });

  it('reports a conflict, without throwing, when a dirty cache meets a moved remote version', async () => {
    await startWorkspaceSync('user-a');
    mocks.saveWorkspace.mockRejectedValueOnce(new TypeError('network unavailable'));
    await editLocally('caredesk.mvp.tasks.v1.client.remote', '[{"id":"pending"}]');
    expect(getWorkspaceSyncState()).toBe('error');

    // Another device saved in the meantime.
    mocks.getWorkspace.mockResolvedValueOnce(remote(9, CHANGED_ELSEWHERE));

    await expect(startWorkspaceSync('user-a')).resolves.toBeUndefined();

    expect(getWorkspaceSyncState()).toBe('conflict');
    // Neither side was destroyed by the reload.
    expect(captureMvpWorkspace().entries['caredesk.mvp.tasks.v1.client.remote']).toBe(
      '[{"id":"pending"}]',
    );
    expect(mocks.saveWorkspace).toHaveBeenCalledTimes(1);
  });

  it('refuses to flush while a conflict is unresolved, so sign-out asks instead of hanging', async () => {
    await reachDivergentConflict();

    await expect(flushWorkspaceSync()).resolves.toBe(false);
    expect(mocks.saveWorkspace).toHaveBeenCalledTimes(1);
  });

  it('flushes cleanly after a failure whose edits were since saved', async () => {
    // A hydration failure leaves the state in 'error' but nothing pending.
    await startWorkspaceSync('user-a');
    mocks.getWorkspace.mockRejectedValueOnce(new TypeError('network unavailable'));
    await expect(startWorkspaceSync('user-a')).rejects.toThrow();
    expect(getWorkspaceSyncState()).toBe('error');

    await expect(flushWorkspaceSync()).resolves.toBe(true);
  });
});

/**
 * UI-WRITE-05. The server refuses a save that would blank most of the
 * workspace (WORKSPACE_SHRINK_REJECTED). That is either the deletion the
 * customer just confirmed or a bug about to erase their account.
 */
describe('workspace sync: shrink refused by the server', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    mocks.getWorkspace.mockReset().mockResolvedValue(remote(4));
    mocks.saveWorkspace
      .mockReset()
      .mockImplementation(async ({ snapshot }) => ({ version: 5, snapshot, updatedAt: '' }));
    mocks.clearLocalDocumentFileCache.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await stopWorkspaceSync();
    vi.useRealTimers();
  });

  async function reachShrinkBlocked() {
    await startWorkspaceSync('user-a');
    mocks.saveWorkspace.mockRejectedValueOnce(
      new mocks.ApiRequestError(409, 'WORKSPACE_SHRINK_REJECTED'),
    );
    mocks.getWorkspace.mockResolvedValueOnce(remote(4));
    localStorage.removeItem('caredesk.mvp.clients.v1');
    window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));
    await vi.advanceTimersByTimeAsync(300);
  }

  it('surfaces the refusal as its own state', async () => {
    await reachShrinkBlocked();

    expect(getWorkspaceSyncState()).toBe('shrink-blocked');
    expect(mocks.saveWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.saveWorkspace.mock.calls[0]?.[0]).not.toHaveProperty('allowShrink');
  });

  it('confirm re-sends the deletion with explicit permission', async () => {
    await reachShrinkBlocked();

    await resolveWorkspaceShrink('confirm');

    expect(mocks.saveWorkspace).toHaveBeenCalledTimes(2);
    expect(mocks.saveWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedVersion: 4,
        allowShrink: true,
        snapshot: expect.objectContaining({ entries: {} }),
      }),
    );
    expect(getWorkspaceSyncState()).toBe('saved');
  });

  it('undo restores the server copy on this device', async () => {
    await reachShrinkBlocked();

    await resolveWorkspaceShrink('undo');

    expect(captureMvpWorkspace().entries).toEqual(REMOTE_ENTRIES);
    expect(getWorkspaceSyncState()).toBe('saved');
    expect(mocks.saveWorkspace).toHaveBeenCalledTimes(1);
  });

  it('permission is one-shot: the next ordinary save carries no allowShrink', async () => {
    await reachShrinkBlocked();
    await resolveWorkspaceShrink('confirm');

    await editLocally('caredesk.mvp.tasks.v1.client.remote', '[]');

    expect(mocks.saveWorkspace).toHaveBeenCalledTimes(3);
    expect(mocks.saveWorkspace.mock.calls[2]?.[0]).not.toHaveProperty('allowShrink');
  });
});

/**
 * GAP-2-01 / GAP-2-03. 401 and 403 are not network blips. A revoked relative
 * must not keep a browsable copy, and a viewer's refused edit must not be
 * retried forever.
 */
describe('workspace sync: access refused by the server', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    mocks.getWorkspace.mockReset().mockResolvedValue(remote(4));
    mocks.saveWorkspace
      .mockReset()
      .mockImplementation(async ({ snapshot }) => ({ version: 5, snapshot, updatedAt: '' }));
    mocks.clearLocalDocumentFileCache.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await stopWorkspaceSync();
    vi.useRealTimers();
  });

  it('recognises 401 and 403 from the API and nothing else', () => {
    expect(isWorkspaceAccessDeniedError(new mocks.ApiRequestError(401, 'UNAUTHENTICATED'))).toBe(
      true,
    );
    expect(isWorkspaceAccessDeniedError(new mocks.ApiRequestError(403, 'FORBIDDEN'))).toBe(true);
    expect(isWorkspaceAccessDeniedError(new mocks.ApiRequestError(503, 'UNAVAILABLE'))).toBe(false);
    expect(isWorkspaceAccessDeniedError(new TypeError('offline'))).toBe(false);
  });

  it('marks the session unauthorized when hydration is refused', async () => {
    mocks.getWorkspace.mockRejectedValueOnce(new mocks.ApiRequestError(401, 'UNAUTHENTICATED'));

    await expect(startWorkspaceSync('user-a')).rejects.toThrow('UNAUTHENTICATED');

    expect(getWorkspaceSyncState()).toBe('unauthorized');
  });

  it('a save refused with 401 whose re-read is also refused is unauthorized, not an error', async () => {
    await startWorkspaceSync('user-a');
    mocks.saveWorkspace.mockRejectedValueOnce(new mocks.ApiRequestError(401, 'UNAUTHENTICATED'));
    mocks.getWorkspace.mockRejectedValueOnce(new mocks.ApiRequestError(401, 'UNAUTHENTICATED'));

    await editLocally('caredesk.mvp.tasks.v1.client.remote', '[{"id":"revoked-edit"}]');

    expect(getWorkspaceSyncState()).toBe('unauthorized');
    // No retry loop: the pending flag is dropped.
    expect(JSON.parse(localStorage.getItem(META_KEY) ?? '{}')).toMatchObject({ dirty: false });
  });

  it('a save refused with 403 re-applies the server copy and settles as read-only', async () => {
    await startWorkspaceSync('user-a');
    mocks.saveWorkspace.mockRejectedValueOnce(new mocks.ApiRequestError(403, 'FORBIDDEN'));
    mocks.getWorkspace.mockResolvedValueOnce(remote(4));

    await editLocally('caredesk.mvp.tasks.v1.client.remote', '[{"id":"viewer-edit"}]');

    expect(getWorkspaceSyncState()).toBe('read-only');
    expect(JSON.parse(localStorage.getItem(META_KEY) ?? '{}')).toMatchObject({ dirty: false });
    // The device converges back to what the server holds.
    expect(captureMvpWorkspace().entries).toEqual(REMOTE_ENTRIES);
    expect(mocks.saveWorkspace).toHaveBeenCalledTimes(1);
  });

  it('an idle tab re-reads the workspace when it becomes visible again and learns of a revocation', async () => {
    await startWorkspaceSync('user-a');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    mocks.getWorkspace.mockRejectedValueOnce(new mocks.ApiRequestError(403, 'FORBIDDEN'));

    // Too soon: nothing is re-read.
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.getWorkspace).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(6 * 60_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.getWorkspace).toHaveBeenCalledTimes(2);
    expect(getWorkspaceSyncState()).toBe('unauthorized');
  });
});

/**
 * SEC-WEB-02 / SEC-WEB-05 / SEC-WEB-06. What sign-out and account switch
 * remove from the device, and what a same-account resume must not remove.
 */
describe('workspace sync: device clean-up', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    mocks.getWorkspace.mockReset().mockResolvedValue(remote(4));
    mocks.saveWorkspace
      .mockReset()
      .mockImplementation(async ({ snapshot }) => ({ version: 5, snapshot, updatedAt: '' }));
    mocks.clearLocalDocumentFileCache.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await stopWorkspaceSync();
    vi.useRealTimers();
  });

  it('reports a blocked document-cache delete on sign-out while still removing every marker', async () => {
    await startWorkspaceSync('user-a');
    expect(localStorage.getItem(OWNER_KEY)).toBe('user-a');
    mocks.clearLocalDocumentFileCache.mockRejectedValueOnce(
      new mocks.DocumentCacheClearError('blocked'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(stopWorkspaceSync()).resolves.toEqual({ documentCacheCleared: false });

    expect(localStorage.getItem(OWNER_KEY)).toBeNull();
    expect(localStorage.getItem(META_KEY)).toBeNull();
    expect(captureMvpWorkspace().entries).toEqual({});
    expect(getWorkspaceSyncState()).toBe('disabled');
    warn.mockRestore();
  });

  it('reports a clean sign-out when the document cache was deleted', async () => {
    await startWorkspaceSync('user-a');
    await expect(stopWorkspaceSync()).resolves.toEqual({ documentCacheCleared: true });
    expect(mocks.clearLocalDocumentFileCache).toHaveBeenCalled();
  });

  it('removes onboarding and legacy-sync residue on sign-out', async () => {
    await startWorkspaceSync('user-a');
    localStorage.setItem('caredesk.onboarding.step.client-1', '3');
    localStorage.setItem('caredesk.onboarding.pending-legal-acceptance.v1', '{"terms":true}');
    localStorage.setItem('caredesk.sync.uploaded.tasks.case-1', '{}');
    localStorage.setItem('caredesk.sync.pendingActions.tasks.case-1', '{}');
    localStorage.setItem('caredesk.ui.theme', 'dark');

    await stopWorkspaceSync();

    expect(
      Object.keys(localStorage).filter((key) => key.startsWith('caredesk.onboarding.')),
    ).toEqual([]);
    expect(Object.keys(localStorage).filter((key) => key.startsWith('caredesk.sync.'))).toEqual([]);
    // UI preferences are the device's, not the account's.
    expect(localStorage.getItem('caredesk.ui.theme')).toBe('dark');
  });

  it('clearAccountScopedResidue is exact about its prefixes', () => {
    localStorage.setItem('caredesk.onboarding.step.x', '1');
    localStorage.setItem('caredesk.sync.uploaded.x', '1');
    localStorage.setItem('caredesk.workspace-sync.v1.user-a', '{"version":1,"dirty":false}');
    localStorage.setItem('caredesk.mvp.clients.v1', '[]');

    clearAccountScopedResidue();

    expect(localStorage.getItem('caredesk.onboarding.step.x')).toBeNull();
    expect(localStorage.getItem('caredesk.sync.uploaded.x')).toBeNull();
    expect(localStorage.getItem('caredesk.workspace-sync.v1.user-a')).not.toBeNull();
    expect(localStorage.getItem('caredesk.mvp.clients.v1')).not.toBeNull();
  });

  it('keeps the same owner’s scans and drafts when only the cache key died with the browser', async () => {
    // The returning-customer case: owner marker matches, but the business
    // cache was written under a session key this browser no longer has.
    localStorage.setItem(OWNER_KEY, 'user-a');
    localStorage.setItem('caredesk.mvp.clients.v1', CIPHERTEXT_FROM_A_DEAD_SESSION);
    localStorage.setItem('caredesk.onboarding.step.client-1', '2');

    await startWorkspaceSync('user-a');

    expect(mocks.clearLocalDocumentFileCache).not.toHaveBeenCalled();
    expect(localStorage.getItem('caredesk.onboarding.step.client-1')).toBe('2');
    // The unreadable cache itself was still replaced by the server copy.
    expect(captureMvpWorkspace().entries).toEqual(REMOTE_ENTRIES);
  });

  it('wipes scans, drafts and residue when a different account takes over the device', async () => {
    localStorage.setItem(OWNER_KEY, 'user-a');
    localStorage.setItem('caredesk.mvp.clients.v1', CIPHERTEXT_FROM_A_DEAD_SESSION);
    localStorage.setItem('caredesk.onboarding.step.client-1', '2');

    await startWorkspaceSync('user-b');

    expect(mocks.clearLocalDocumentFileCache).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('caredesk.onboarding.step.client-1')).toBeNull();
  });
});

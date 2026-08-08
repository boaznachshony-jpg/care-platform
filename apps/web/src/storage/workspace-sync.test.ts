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
  return {
    ApiRequestError: MockApiRequestError,
    getWorkspace: vi.fn(),
    saveWorkspace: vi.fn(),
  };
});

vi.mock('../api/client.js', () => ({
  ApiRequestError: mocks.ApiRequestError,
  getWorkspace: mocks.getWorkspace,
  saveWorkspace: mocks.saveWorkspace,
}));

import { captureMvpWorkspace, MVP_PROFILE_CHANGED } from './mvp-storage.js';
import {
  flushWorkspaceSync,
  getWorkspaceSyncState,
  hasWorkspaceRecoverySnapshot,
  pauseWorkspaceSync,
  retryWorkspaceSync,
  restoreWorkspaceRecoverySnapshot,
  startWorkspaceSync,
  stopWorkspaceSync,
} from './workspace-sync.js';

describe('workspace sync', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    mocks.getWorkspace.mockReset();
    mocks.saveWorkspace.mockReset();
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

  afterEach(() => {
    stopWorkspaceSync();
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

  it('fails closed instead of replacing a populated same-user cache with an empty workspace', async () => {
    await startWorkspaceSync('user-a');
    const preserved = localStorage.getItem('caredesk.mvp.clients.v1');
    pauseWorkspaceSync();
    mocks.getWorkspace.mockResolvedValueOnce({
      version: 5,
      snapshot: { schemaVersion: 1, entries: {} },
      updatedAt: '',
    });

    await expect(startWorkspaceSync('user-a')).rejects.toThrow('WORKSPACE_SUSPICIOUS_REMOTE');

    expect(localStorage.getItem('caredesk.mvp.clients.v1')).toBe(preserved);
    expect(getWorkspaceSyncState()).toBe('error');
  });

  it('rejects schema downgrade without touching the local cache', async () => {
    await startWorkspaceSync('user-a');
    const preserved = localStorage.getItem('caredesk.mvp.clients.v1');
    pauseWorkspaceSync();
    mocks.getWorkspace.mockResolvedValueOnce({
      version: 5,
      snapshot: { schemaVersion: 0, entries: {} },
      updatedAt: '',
    });

    await expect(startWorkspaceSync('user-a')).rejects.toThrow('WORKSPACE_SCHEMA_UNSUPPORTED');
    expect(localStorage.getItem('caredesk.mvp.clients.v1')).toBe(preserved);
  });

  it('keeps an encrypted recovery snapshot before applying a newer remote workspace', async () => {
    await startWorkspaceSync('user-a');
    const previousEncrypted = localStorage.getItem('caredesk.mvp.clients.v1');
    pauseWorkspaceSync();
    mocks.getWorkspace.mockResolvedValueOnce({
      version: 5,
      snapshot: {
        schemaVersion: 1,
        entries: { 'caredesk.mvp.clients.v1': '[{"id":"newer"}]' },
      },
      updatedAt: '',
    });

    await startWorkspaceSync('user-a');

    const backup = JSON.parse(
      localStorage.getItem('caredesk.workspace-backup.v1.user-a') ?? '{}',
    ) as { entries?: Record<string, string> };
    expect(backup.entries?.['caredesk.mvp.clients.v1']).toBe(previousEncrypted);
  });

  it('restores a validated same-user recovery snapshot and marks it unsynced', async () => {
    await startWorkspaceSync('user-a');
    const original = localStorage.getItem('caredesk.mvp.clients.v1');
    pauseWorkspaceSync();
    mocks.getWorkspace.mockResolvedValueOnce({
      version: 5,
      snapshot: {
        schemaVersion: 1,
        entries: { 'caredesk.mvp.clients.v1': '[{"id":"newer"}]' },
      },
      updatedAt: '',
    });
    await startWorkspaceSync('user-a');

    expect(hasWorkspaceRecoverySnapshot('user-a')).toBe(true);
    expect(restoreWorkspaceRecoverySnapshot('different-user')).toBe(false);
    expect(restoreWorkspaceRecoverySnapshot('user-a')).toBe(true);
    expect(localStorage.getItem('caredesk.mvp.clients.v1')).toBe(original);
    expect(getWorkspaceSyncState()).toBe('error');
    await expect(flushWorkspaceSync()).resolves.toBe(true);
    expect(mocks.saveWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedVersion: 5,
        snapshot: expect.objectContaining({
          entries: expect.objectContaining({
            'caredesk.mvp.clients.v1': '[{"id":"remote"}]',
          }),
        }),
      }),
    );
  });

  it('rejects malformed recovery snapshots without changing business data', async () => {
    await startWorkspaceSync('user-a');
    const original = localStorage.getItem('caredesk.mvp.clients.v1');
    localStorage.setItem(
      'caredesk.workspace-backup.v1.user-a',
      JSON.stringify({ schemaVersion: 1, createdAt: '', entries: { unsafe: 'value' } }),
    );

    expect(hasWorkspaceRecoverySnapshot('user-a')).toBe(false);
    expect(restoreWorkspaceRecoverySnapshot('user-a')).toBe(false);
    expect(localStorage.getItem('caredesk.mvp.clients.v1')).toBe(original);
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

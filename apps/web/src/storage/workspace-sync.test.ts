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
  getWorkspaceSyncState,
  retryWorkspaceSync,
  startWorkspaceSync,
  stopWorkspaceSync,
} from './workspace-sync.js';

describe('workspace sync', () => {
  beforeEach(() => {
    localStorage.clear();
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

    await startWorkspaceSync();

    expect(captureMvpWorkspace().entries['caredesk.mvp.clients.v1']).toBe('[{"id":"remote"}]');
    // Device-only accessibility preferences are intentionally not server data.
    expect(localStorage.getItem('caredesk.ui.font-scale.v1')).toBe('1.3');
  });

  it('persists changes with optimistic concurrency', async () => {
    await startWorkspaceSync();
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

  it('recovers a deployment-time version conflict when the remote content is unchanged', async () => {
    await startWorkspaceSync();
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
    await startWorkspaceSync();
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
    await startWorkspaceSync();
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
});

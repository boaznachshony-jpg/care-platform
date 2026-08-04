import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  saveWorkspace: vi.fn(),
}));

vi.mock('../api/client.js', () => ({
  ApiRequestError: class extends Error {},
  getWorkspace: mocks.getWorkspace,
  saveWorkspace: mocks.saveWorkspace,
}));

import { MVP_PROFILE_CHANGED } from './mvp-storage.js';
import { startWorkspaceSync, stopWorkspaceSync } from './workspace-sync.js';

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
    mocks.saveWorkspace.mockResolvedValue({ version: 5, snapshot: {}, updatedAt: '' });
  });

  afterEach(() => {
    stopWorkspaceSync();
    vi.useRealTimers();
  });

  it('clears another account cache and hydrates the authenticated workspace', async () => {
    localStorage.setItem('caredesk.mvp.clients.v1', '[{"id":"old-account"}]');
    localStorage.setItem('caredesk.ui.font-scale.v1', '1.3');

    await startWorkspaceSync();

    expect(localStorage.getItem('caredesk.mvp.clients.v1')).toBe('[{"id":"remote"}]');
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
});

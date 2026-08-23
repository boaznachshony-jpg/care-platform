import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The production incident this file exists for.
 *
 * A returning customer opened the app and was shown "you have no cases" while
 * 8.5KB of their workspace sat intact on the server at version 295. Measured on
 * the live page: zero requests to /workspace, and 27 local cache keys of which
 * none decrypted - the cache key lives in sessionStorage and dies with the
 * browser, while the cached data lives in localStorage and survives.
 *
 * The cause was a guard in applySession that skipped hydration whenever the
 * incoming user matched the current one. Once currentUserId was set, hydration
 * could be skipped forever. The recovery path that reads an unreadable cache
 * and refetches from the server lives INSIDE startWorkspaceSync, so it never
 * got the chance to run.
 *
 * An empty screen that means "we could not load your data" must never be
 * rendered as "you have no data".
 */

const mocks = vi.hoisted(() => ({
  startWorkspaceSync: vi.fn(),
  canUseCachedWorkspace: vi.fn(),
  flushWorkspaceSync: vi.fn(),
  pauseWorkspaceSync: vi.fn(),
  stopWorkspaceSync: vi.fn(),
  prewarmApi: vi.fn(),
  onAuthStateChange: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('../storage/workspace-sync.js', () => ({
  startWorkspaceSync: mocks.startWorkspaceSync,
  canUseCachedWorkspace: mocks.canUseCachedWorkspace,
  flushWorkspaceSync: mocks.flushWorkspaceSync,
  pauseWorkspaceSync: mocks.pauseWorkspaceSync,
  stopWorkspaceSync: mocks.stopWorkspaceSync,
}));

vi.mock('../api/client.js', () => ({ prewarmApi: mocks.prewarmApi }));

vi.mock('./client.js', () => ({
  getBrowserAuthClient: () => ({
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signOut: vi.fn(),
    },
  }),
}));

import { AuthProvider } from './auth-context.js';

const USER = { id: 'user-synthetic-001' };

function renderGate() {
  return render(
    <AuthProvider
      login={<p>מסך כניסה</p>}
      configurationRequired={<p>נדרשת הגדרה</p>}
      storageUnavailable={<p>לא ניתן לטעון את הנתונים המאובטחים</p>}
      passwordRecovery={<p>שחזור סיסמה</p>}
      loading={<p>טוענים</p>}
    >
      <p>התיקים שלי</p>
    </AuthProvider>,
  );
}

describe('workspace hydration on a returning visit', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.prewarmApi.mockResolvedValue(undefined);
    mocks.flushWorkspaceSync.mockResolvedValue(true);
    mocks.startWorkspaceSync.mockResolvedValue(undefined);
    // The device cache is unreadable - exactly the returning-customer case.
    mocks.canUseCachedWorkspace.mockReturnValue(false);
    mocks.getSession.mockResolvedValue({ data: { session: { user: USER } } });
    mocks.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('always fetches the workspace from the server on a restored session', async () => {
    renderGate();
    await waitFor(() => expect(mocks.startWorkspaceSync).toHaveBeenCalledWith(USER.id));
  });

  it('re-runs hydration when the same session is re-applied before it ever succeeded', async () => {
    // This is the regression: applySession firing twice for the same user must
    // not let the second call short-circuit past a hydration that never ran.
    mocks.startWorkspaceSync.mockRejectedValueOnce(new Error('WORKSPACE_UNAVAILABLE'));
    renderGate();

    await waitFor(() => expect(mocks.startWorkspaceSync).toHaveBeenCalledTimes(1));

    const handler = mocks.onAuthStateChange.mock.calls[0]?.[0] as
      ((event: string, session: unknown) => void) | undefined;
    expect(handler).toBeTypeOf('function');
    handler?.('SIGNED_IN', { user: USER });

    await waitFor(() => expect(mocks.startWorkspaceSync).toHaveBeenCalledTimes(2));
  });

  it('locks the app with an explicit message instead of showing an empty workspace', async () => {
    mocks.startWorkspaceSync.mockRejectedValue(new Error('WORKSPACE_UNAVAILABLE'));
    renderGate();

    await waitFor(() =>
      expect(screen.getByText('לא ניתן לטעון את הנתונים המאובטחים')).toBeInTheDocument(),
    );
    // The customer must never be told they have no cases when the truth is
    // that their workspace could not be read.
    expect(screen.queryByText('התיקים שלי')).not.toBeInTheDocument();
  });
});

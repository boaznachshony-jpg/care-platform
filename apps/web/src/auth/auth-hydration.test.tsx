import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';

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
    startWorkspaceSync: vi.fn(),
    canUseCachedWorkspace: vi.fn(),
    flushWorkspaceSync: vi.fn(),
    pauseWorkspaceSync: vi.fn(),
    stopWorkspaceSync: vi.fn(),
    getWorkspaceSyncState: vi.fn(),
    prewarmApi: vi.fn(),
    listFamilyMembers: vi.fn(),
    onAuthStateChange: vi.fn(),
    getSession: vi.fn(),
    signOut: vi.fn(),
  };
});

vi.mock('../storage/workspace-sync.js', () => ({
  startWorkspaceSync: mocks.startWorkspaceSync,
  canUseCachedWorkspace: mocks.canUseCachedWorkspace,
  flushWorkspaceSync: mocks.flushWorkspaceSync,
  pauseWorkspaceSync: mocks.pauseWorkspaceSync,
  stopWorkspaceSync: mocks.stopWorkspaceSync,
  getWorkspaceSyncState: mocks.getWorkspaceSyncState,
  isWorkspaceAccessDeniedError: (error: unknown) =>
    error instanceof mocks.ApiRequestError && (error.status === 401 || error.status === 403),
  WORKSPACE_SYNC_CHANGED: 'caredesk:workspace-sync-changed',
}));

vi.mock('../api/client.js', () => ({
  ApiRequestError: mocks.ApiRequestError,
  prewarmApi: mocks.prewarmApi,
  listFamilyMembers: mocks.listFamilyMembers,
}));

vi.mock('./client.js', () => ({
  getBrowserAuthClient: () => ({
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signOut: mocks.signOut,
    },
  }),
}));

import { AuthProvider, useAuth } from './auth-context.js';

const USER = { id: 'user-synthetic-001' };

function CaseList() {
  const auth = useAuth();
  return (
    <div>
      <p>התיקים שלי</p>
      <button type="button" onClick={() => void auth.signOut()}>
        יציאה מהחשבון
      </button>
    </div>
  );
}

function renderGate() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <MemoryRouter>
        <AuthProvider
          login={<p>מסך כניסה</p>}
          configurationRequired={<p>נדרשת הגדרה</p>}
          storageUnavailable={<p>לא ניתן לטעון את הנתונים המאובטחים</p>}
          passwordRecovery={<p>שחזור סיסמה</p>}
          loading={<p>טוענים</p>}
        >
          <CaseList />
        </AuthProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

function authHandler() {
  const handler = mocks.onAuthStateChange.mock.calls[0]?.[0] as
    ((event: string, session: unknown) => void) | undefined;
  expect(handler).toBeTypeOf('function');
  return handler!;
}

describe('workspace hydration on a returning visit', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      if (typeof mock === 'function' && 'mockReset' in mock) mock.mockReset();
    }
    mocks.prewarmApi.mockResolvedValue(undefined);
    mocks.listFamilyMembers.mockResolvedValue({ canManage: true, members: [] });
    mocks.flushWorkspaceSync.mockResolvedValue(true);
    mocks.startWorkspaceSync.mockResolvedValue(undefined);
    mocks.stopWorkspaceSync.mockResolvedValue({ documentCacheCleared: true });
    mocks.getWorkspaceSyncState.mockReturnValue('saved');
    mocks.signOut.mockResolvedValue({ error: null });
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

    authHandler()('SIGNED_IN', { user: USER });

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

  /**
   * GAP-2-01. A revoked family member's device held a decrypted copy of the
   * whole family workspace, and a 401 from /workspace was handled like a
   * network blip: the trusted same-user cache stayed on screen.
   */
  it('purges the device and shows the access-removed screen when the server refuses the workspace', async () => {
    // A same-user cache is present and would otherwise be shown immediately.
    mocks.canUseCachedWorkspace.mockReturnValue(true);
    mocks.startWorkspaceSync.mockRejectedValue(new mocks.ApiRequestError(401, 'UNAUTHENTICATED'));
    renderGate();

    expect(await screen.findByRole('heading', { name: 'הגישה לתיק הוסרה' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.stopWorkspaceSync).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('התיקים שלי')).not.toBeInTheDocument();
    expect(screen.queryByText('לא ניתן לטעון את הנתונים המאובטחים')).not.toBeInTheDocument();

    // The only way out is a clean sign-out, which lands on the login screen.
    fireEvent.click(screen.getByRole('button', { name: 'יציאה' }));
    expect(await screen.findByText('מסך כניסה')).toBeInTheDocument();
  });

  /**
   * UI-NAV-01. After a sign-out in the same tab, the "children have been shown"
   * flag stayed true, so the next sign-in rendered the app before hydration.
   * The client list mounted against an empty cache and never refreshed.
   */
  it('after sign-out, a fresh sign-in shows the loading screen and not the children until hydration resolves', async () => {
    renderGate();
    expect(await screen.findByText('התיקים שלי')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'יציאה מהחשבון' }));
    expect(await screen.findByText('מסך כניסה')).toBeInTheDocument();

    let finishHydration!: () => void;
    mocks.startWorkspaceSync.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishHydration = resolve;
      }),
    );
    authHandler()('SIGNED_IN', { user: USER });

    expect(await screen.findByText('טוענים')).toBeInTheDocument();
    expect(screen.queryByText('התיקים שלי')).not.toBeInTheDocument();

    finishHydration();
    expect(await screen.findByText('התיקים שלי')).toBeInTheDocument();
  });
});

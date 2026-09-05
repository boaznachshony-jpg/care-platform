import { createElement, useState, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    prewarmApi: vi.fn(),
    listFamilyMembers: vi.fn(),
    canUseCachedWorkspace: vi.fn(),
    flushWorkspaceSync: vi.fn(),
    pauseWorkspaceSync: vi.fn(),
    startWorkspaceSync: vi.fn(),
    stopWorkspaceSync: vi.fn(),
    getWorkspaceSyncState: vi.fn(),
    isWorkspaceAccessDeniedError: vi.fn(),
    clearLocalDocumentFileCache: vi.fn(),
    getSession: vi.fn(),
    refreshSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    resend: vi.fn(),
    signInWithOtp: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
  };
});

vi.mock('../api/client.js', () => ({
  ApiRequestError: mocks.ApiRequestError,
  prewarmApi: mocks.prewarmApi,
  listFamilyMembers: mocks.listFamilyMembers,
}));

vi.mock('./client.js', () => ({
  getBrowserAuthClient: () => ({
    auth: {
      getSession: mocks.getSession,
      refreshSession: mocks.refreshSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signInWithPassword: mocks.signInWithPassword,
      signUp: mocks.signUp,
      resend: mocks.resend,
      signInWithOtp: mocks.signInWithOtp,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      updateUser: mocks.updateUser,
      signOut: mocks.signOut,
    },
  }),
}));

vi.mock('../storage/workspace-sync.js', () => ({
  canUseCachedWorkspace: mocks.canUseCachedWorkspace,
  flushWorkspaceSync: mocks.flushWorkspaceSync,
  pauseWorkspaceSync: mocks.pauseWorkspaceSync,
  startWorkspaceSync: mocks.startWorkspaceSync,
  stopWorkspaceSync: mocks.stopWorkspaceSync,
  getWorkspaceSyncState: mocks.getWorkspaceSyncState,
  isWorkspaceAccessDeniedError: mocks.isWorkspaceAccessDeniedError,
  WORKSPACE_SYNC_CHANGED: 'caredesk:workspace-sync-changed',
}));

vi.mock('../storage/document-file-store.js', () => ({
  clearLocalDocumentFileCache: mocks.clearLocalDocumentFileCache,
}));

import { AuthProvider, resolveAuthGateState, useAuth } from './auth-context.js';

let authStateListener:
  ((event: string, session: { user: { id: string } } | null) => void) | undefined;

/** Signs out and shows the named result, the way SignOutButton does. */
function SignOutProbe() {
  const auth = useAuth();
  const [result, setResult] = useState('');
  return createElement(
    'div',
    null,
    createElement('button', { onClick: () => void auth.signOut().then(setResult) }, 'sign out'),
    createElement(
      'button',
      { onClick: () => void auth.signOut({ discardUnsaved: true }).then(setResult) },
      'discard and sign out',
    ),
    createElement('span', null, `result:${result}`),
  );
}

function MagicLinkProbe() {
  const auth = useAuth();
  return createElement(
    'button',
    { onClick: () => void auth.requestMagicLink('owner@example.test') },
    'send magic link',
  );
}

function CanWriteProbe() {
  const auth = useAuth();
  return createElement('span', null, `canWrite:${String(auth.canWrite)}`);
}

/** Stands in for LoginPage: it reads the outcome of the last sign-out. */
function LoginProbe() {
  const auth = useAuth();
  return createElement(
    'div',
    null,
    'login',
    auth.lastSignOut?.documentCacheCleared === false
      ? createElement('p', { role: 'alert' }, 'files remain on this device')
      : null,
  );
}

function renderProvider(
  children: ReactNode = createElement('div', null, 'workspace'),
  options: { login?: ReactNode; accessRevoked?: ReactNode } = {},
) {
  return render(
    createElement(
      AuthProvider,
      {
        login: options.login ?? createElement('div', null, 'login'),
        configurationRequired: createElement('div', null, 'configuration'),
        storageUnavailable: createElement('div', null, 'storage unavailable'),
        accessRevoked: options.accessRevoked,
        passwordRecovery: createElement('div', null, 'password recovery'),
        loading: createElement('div', null, 'loading'),
      },
      children,
    ),
  );
}

describe('authentication gate', () => {
  beforeEach(() => {
    mocks.prewarmApi.mockReset();
    mocks.prewarmApi.mockResolvedValue(undefined);
    mocks.listFamilyMembers.mockReset();
    mocks.listFamilyMembers.mockResolvedValue({ canManage: true, members: [] });
    mocks.canUseCachedWorkspace.mockReset();
    mocks.flushWorkspaceSync.mockReset();
    mocks.flushWorkspaceSync.mockResolvedValue(true);
    mocks.pauseWorkspaceSync.mockReset();
    mocks.startWorkspaceSync.mockReset();
    mocks.stopWorkspaceSync.mockReset();
    mocks.stopWorkspaceSync.mockResolvedValue({ documentCacheCleared: true });
    mocks.getWorkspaceSyncState.mockReset();
    mocks.getWorkspaceSyncState.mockReturnValue('saved');
    mocks.isWorkspaceAccessDeniedError.mockReset();
    mocks.isWorkspaceAccessDeniedError.mockImplementation(
      (error: unknown) =>
        error instanceof mocks.ApiRequestError && (error.status === 401 || error.status === 403),
    );
    mocks.clearLocalDocumentFileCache.mockReset();
    mocks.clearLocalDocumentFileCache.mockResolvedValue(undefined);
    mocks.signOut.mockReset();
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.signInWithOtp.mockReset();
    mocks.signInWithOtp.mockResolvedValue({ error: null });
    mocks.getSession.mockReset();
    mocks.refreshSession.mockReset();
    mocks.refreshSession.mockResolvedValue({ data: { session: null }, error: null });
    mocks.onAuthStateChange.mockReset();
    authStateListener = undefined;
    mocks.onAuthStateChange.mockImplementation((listener) => {
      authStateListener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('allows an explicit local-only bypass when no provider is configured', () => {
    expect(resolveAuthGateState(false, 'local')).toBe('local-bypass');
  });

  it('fails closed in staging and production without provider configuration', () => {
    expect(resolveAuthGateState(false, 'staging')).toBe('configuration-required');
    expect(resolveAuthGateState(false, 'production')).toBe('configuration-required');
  });

  it('loads the remote session when provider configuration exists', () => {
    expect(resolveAuthGateState(true, 'staging')).toBe('loading');
  });

  it('returns passwordless first-time entry to client onboarding', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-a' } } } });
    mocks.canUseCachedWorkspace.mockReturnValue(true);
    mocks.startWorkspaceSync.mockResolvedValue(undefined);

    renderProvider(createElement(MagicLinkProbe));
    fireEvent.click(await screen.findByRole('button', { name: 'send magic link' }));

    await waitFor(() =>
      expect(mocks.signInWithOtp).toHaveBeenCalledWith({
        email: 'owner@example.test',
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/app?firstRun=1`,
        },
      }),
    );
  });

  it('renders a persisted same-user workspace without waiting for remote hydration', async () => {
    let finishHydration!: () => void;
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-a' } } } });
    mocks.canUseCachedWorkspace.mockReturnValue(true);
    mocks.startWorkspaceSync.mockReturnValue(
      new Promise<void>((resolve) => {
        finishHydration = resolve;
      }),
    );

    renderProvider();

    expect(await screen.findByText('workspace')).toBeInTheDocument();
    expect(screen.queryByText('loading')).not.toBeInTheDocument();
    expect(mocks.startWorkspaceSync).toHaveBeenCalledWith('user-a');

    finishHydration();
  });

  it('waits for hydration when no account-scoped cache can be trusted', async () => {
    let finishHydration!: () => void;
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-a' } } } });
    mocks.canUseCachedWorkspace.mockReturnValue(false);
    mocks.startWorkspaceSync.mockReturnValue(
      new Promise<void>((resolve) => {
        finishHydration = resolve;
      }),
    );

    renderProvider();

    expect(await screen.findByText('loading')).toBeInTheDocument();
    expect(screen.queryByText('workspace')).not.toBeInTheDocument();

    finishHydration();
    await waitFor(() => expect(screen.getByText('workspace')).toBeInTheDocument());
  });

  it('finishes API warm-up before the first uncached workspace request', async () => {
    let finishWarmup!: () => void;
    mocks.prewarmApi.mockReturnValue(
      new Promise<void>((resolve) => {
        finishWarmup = resolve;
      }),
    );
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-a' } } } });
    mocks.canUseCachedWorkspace.mockReturnValue(false);
    mocks.startWorkspaceSync.mockResolvedValue(undefined);

    renderProvider();

    expect(await screen.findByText('loading')).toBeInTheDocument();
    expect(mocks.startWorkspaceSync).not.toHaveBeenCalled();

    finishWarmup();
    await waitFor(() => expect(mocks.startWorkspaceSync).toHaveBeenCalledWith('user-a'));
    await waitFor(() => expect(screen.getByText('workspace')).toBeInTheDocument());
  });

  it('keeps a trusted local workspace available after a hydration failure', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-a' } } } });
    mocks.canUseCachedWorkspace.mockReturnValue(true);
    mocks.startWorkspaceSync.mockRejectedValue(new TypeError('offline'));

    renderProvider();

    expect(await screen.findByText('workspace')).toBeInTheDocument();
    expect(screen.queryByText('storage unavailable')).not.toBeInTheDocument();
  });

  it('fails closed when first hydration fails without a trusted cache', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-a' } } } });
    mocks.canUseCachedWorkspace.mockReturnValue(false);
    mocks.startWorkspaceSync.mockRejectedValue(new TypeError('offline'));

    renderProvider();

    expect(await screen.findByText('storage unavailable')).toBeInTheDocument();
    expect(screen.queryByText('workspace')).not.toBeInTheDocument();
  });

  it('recovers a temporary null auth event before showing the login screen', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-a' } } } });
    mocks.canUseCachedWorkspace.mockReturnValue(true);
    mocks.startWorkspaceSync.mockResolvedValue(undefined);

    renderProvider();
    expect(await screen.findByText('workspace')).toBeInTheDocument();

    vi.useFakeTimers();
    act(() => authStateListener?.('SIGNED_OUT', null));
    expect(screen.getByText('loading')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    vi.useRealTimers();

    expect(mocks.pauseWorkspaceSync).toHaveBeenCalled();
    expect(mocks.getSession).toHaveBeenCalledTimes(2);
    expect(screen.getByText('workspace')).toBeInTheDocument();
    expect(screen.queryByText('login')).not.toBeInTheDocument();
    expect(mocks.stopWorkspaceSync).not.toHaveBeenCalled();
  });

  it('refreshes the token when persisted state is still empty', async () => {
    mocks.getSession
      .mockResolvedValueOnce({ data: { session: { user: { id: 'user-a' } } } })
      .mockResolvedValueOnce({ data: { session: null } });
    mocks.refreshSession.mockResolvedValue({
      data: { session: { user: { id: 'user-a' } } },
      error: null,
    });
    mocks.canUseCachedWorkspace.mockReturnValue(true);
    mocks.startWorkspaceSync.mockResolvedValue(undefined);
    renderProvider();
    expect(await screen.findByText('workspace')).toBeInTheDocument();

    vi.useFakeTimers();
    act(() => authStateListener?.('TOKEN_REFRESHED', null));
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    vi.useRealTimers();

    expect(mocks.refreshSession).toHaveBeenCalledOnce();
    expect(screen.getByText('workspace')).toBeInTheDocument();
  });

  it('fails closed after the grace period when session recovery is not valid', async () => {
    mocks.getSession
      .mockResolvedValueOnce({ data: { session: { user: { id: 'user-a' } } } })
      .mockResolvedValueOnce({ data: { session: null } });
    mocks.canUseCachedWorkspace.mockReturnValue(true);
    mocks.startWorkspaceSync.mockResolvedValue(undefined);
    renderProvider();
    expect(await screen.findByText('workspace')).toBeInTheDocument();

    vi.useFakeTimers();
    act(() => authStateListener?.('SIGNED_OUT', null));
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    vi.useRealTimers();

    expect(mocks.refreshSession).toHaveBeenCalledOnce();
    expect(screen.getByText('login')).toBeInTheDocument();
  });

  it('flushes pending edits before an explicit sign-out clears the cache', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-a' } } } });
    mocks.canUseCachedWorkspace.mockReturnValue(true);
    mocks.startWorkspaceSync.mockResolvedValue(undefined);

    renderProvider(createElement(SignOutProbe));
    fireEvent.click(await screen.findByRole('button', { name: 'sign out' }));

    await waitFor(() => expect(mocks.stopWorkspaceSync).toHaveBeenCalled());
    expect(mocks.flushWorkspaceSync.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signOut.mock.invocationCallOrder[0]!,
    );
    expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.stopWorkspaceSync.mock.invocationCallOrder[0]!,
    );
  });
});

/**
 * SEC-WEB-01. signOut used to resolve a bare `false` whenever the last cloud
 * save had failed, and every caller discarded it. The customer pressed "sign
 * out" on a shared computer and stayed signed in, with no message.
 */
describe('sign-out outcomes', () => {
  beforeEach(() => {
    mocks.prewarmApi.mockReset().mockResolvedValue(undefined);
    mocks.listFamilyMembers.mockReset().mockResolvedValue({ canManage: true, members: [] });
    mocks.canUseCachedWorkspace.mockReset().mockReturnValue(true);
    mocks.flushWorkspaceSync.mockReset().mockResolvedValue(true);
    mocks.pauseWorkspaceSync.mockReset();
    mocks.startWorkspaceSync.mockReset().mockResolvedValue(undefined);
    mocks.stopWorkspaceSync.mockReset().mockResolvedValue({ documentCacheCleared: true });
    mocks.getWorkspaceSyncState.mockReset().mockReturnValue('saved');
    mocks.isWorkspaceAccessDeniedError.mockReset().mockReturnValue(false);
    mocks.clearLocalDocumentFileCache.mockReset().mockResolvedValue(undefined);
    mocks.signOut.mockReset().mockResolvedValue({ error: null });
    mocks.getSession
      .mockReset()
      .mockResolvedValue({ data: { session: { user: { id: 'user-a' } } } });
    mocks.refreshSession.mockReset().mockResolvedValue({ data: { session: null }, error: null });
    mocks.onAuthStateChange.mockReset().mockImplementation((listener) => {
      authStateListener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('names unsaved changes instead of silently refusing', async () => {
    mocks.flushWorkspaceSync.mockResolvedValue(false);

    renderProvider(createElement(SignOutProbe));
    fireEvent.click(await screen.findByRole('button', { name: 'sign out' }));

    await screen.findByText('result:unsaved-changes');
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.stopWorkspaceSync).not.toHaveBeenCalled();
    // Still signed in, still on the workspace - nothing was cleared.
    expect(screen.getByText('discard and sign out')).toBeInTheDocument();
  });

  it('signs out anyway when the customer chooses to discard unsaved edits', async () => {
    mocks.flushWorkspaceSync.mockResolvedValue(false);

    renderProvider(createElement(SignOutProbe));
    fireEvent.click(await screen.findByRole('button', { name: 'discard and sign out' }));

    await waitFor(() => expect(mocks.stopWorkspaceSync).toHaveBeenCalled());
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    // The flush is skipped on purpose; the customer said so.
    expect(mocks.flushWorkspaceSync).not.toHaveBeenCalled();
    expect(await screen.findByText('login')).toBeInTheDocument();
  });

  it('clears the device when the provider fails to end a session that is already gone', async () => {
    mocks.signOut.mockResolvedValue({ error: new Error('session_not_found') });
    mocks.getSession
      .mockReset()
      .mockResolvedValueOnce({ data: { session: { user: { id: 'user-a' } } } })
      .mockResolvedValue({ data: { session: null } });

    renderProvider(createElement(SignOutProbe));
    fireEvent.click(await screen.findByRole('button', { name: 'sign out' }));

    await waitFor(() => expect(mocks.stopWorkspaceSync).toHaveBeenCalled());
    expect(await screen.findByText('login')).toBeInTheDocument();
  });

  it('reports an error, and clears nothing, when the provider refuses and the session persists', async () => {
    mocks.signOut.mockResolvedValue({ error: new Error('network') });

    renderProvider(createElement(SignOutProbe));
    fireEvent.click(await screen.findByRole('button', { name: 'sign out' }));

    await screen.findByText('result:error');
    expect(mocks.stopWorkspaceSync).not.toHaveBeenCalled();
    expect(screen.queryByText('login')).not.toBeInTheDocument();
  });

  it('tells the login page when local files could not be deleted', async () => {
    mocks.stopWorkspaceSync.mockResolvedValue({ documentCacheCleared: false });

    renderProvider(createElement(SignOutProbe), { login: createElement(LoginProbe) });
    fireEvent.click(await screen.findByRole('button', { name: 'sign out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('files remain on this device');
  });

  it('exposes a viewer role as read-only after hydration', async () => {
    mocks.listFamilyMembers.mockResolvedValue({
      canManage: false,
      members: [
        { membershipId: 'm-1', role: 'owner', isCurrentUser: false },
        { membershipId: 'm-2', role: 'viewer', isCurrentUser: true },
      ],
    });

    renderProvider(createElement(CanWriteProbe));

    expect(await screen.findByText('canWrite:false')).toBeInTheDocument();
  });

  it('treats an unknown role as writable so a failed lookup never locks an owner out', async () => {
    mocks.listFamilyMembers.mockRejectedValue(new mocks.ApiRequestError(403, 'FORBIDDEN'));

    renderProvider(createElement(CanWriteProbe));

    expect(await screen.findByText('canWrite:true')).toBeInTheDocument();
    // Give the rejected lookup a tick to settle; the answer must not flip.
    await act(async () => undefined);
    expect(screen.getByText('canWrite:true')).toBeInTheDocument();
  });

  it('purges the device and locks the app when the sync layer reports a revocation', async () => {
    renderProvider(createElement('div', null, 'workspace'), {
      accessRevoked: createElement('div', null, 'access removed'),
    });
    expect(await screen.findByText('workspace')).toBeInTheDocument();

    mocks.getWorkspaceSyncState.mockReturnValue('unauthorized');
    act(() => {
      window.dispatchEvent(new CustomEvent('caredesk:workspace-sync-changed'));
    });

    expect(await screen.findByText('access removed')).toBeInTheDocument();
    expect(mocks.stopWorkspaceSync).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('workspace')).not.toBeInTheDocument();
  });
});

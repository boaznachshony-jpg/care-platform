import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prewarmApi: vi.fn(),
  canUseCachedWorkspace: vi.fn(),
  flushWorkspaceSync: vi.fn(),
  pauseWorkspaceSync: vi.fn(),
  startWorkspaceSync: vi.fn(),
  stopWorkspaceSync: vi.fn(),
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
}));

vi.mock('../api/client.js', () => ({
  prewarmApi: mocks.prewarmApi,
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
}));

import { AuthProvider, resolveAuthGateState, useAuth } from './auth-context.js';

let authStateListener:
  ((event: string, session: { user: { id: string } } | null) => void) | undefined;

function SignOutProbe() {
  const auth = useAuth();
  return createElement('button', { onClick: () => void auth.signOut() }, 'sign out');
}

function renderProvider(children: ReactNode = createElement('div', null, 'workspace')) {
  return render(
    createElement(
      AuthProvider,
      {
        login: createElement('div', null, 'login'),
        configurationRequired: createElement('div', null, 'configuration'),
        storageUnavailable: createElement('div', null, 'storage unavailable'),
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
    mocks.canUseCachedWorkspace.mockReset();
    mocks.flushWorkspaceSync.mockReset();
    mocks.flushWorkspaceSync.mockResolvedValue(true);
    mocks.pauseWorkspaceSync.mockReset();
    mocks.startWorkspaceSync.mockReset();
    mocks.stopWorkspaceSync.mockReset();
    mocks.signOut.mockReset();
    mocks.signOut.mockResolvedValue({ error: null });
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

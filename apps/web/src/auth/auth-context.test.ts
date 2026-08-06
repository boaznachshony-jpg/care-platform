import { createElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canUseCachedWorkspace: vi.fn(),
  startWorkspaceSync: vi.fn(),
  stopWorkspaceSync: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signInWithOtp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('./client.js', () => ({
  getBrowserAuthClient: () => ({
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signInWithPassword: mocks.signInWithPassword,
      signUp: mocks.signUp,
      signInWithOtp: mocks.signInWithOtp,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      updateUser: mocks.updateUser,
      signOut: mocks.signOut,
    },
  }),
}));

vi.mock('../storage/workspace-sync.js', () => ({
  canUseCachedWorkspace: mocks.canUseCachedWorkspace,
  startWorkspaceSync: mocks.startWorkspaceSync,
  stopWorkspaceSync: mocks.stopWorkspaceSync,
}));

import { AuthProvider, resolveAuthGateState } from './auth-context.js';

function renderProvider() {
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
      createElement('div', null, 'workspace'),
    ),
  );
}

describe('authentication gate', () => {
  beforeEach(() => {
    mocks.canUseCachedWorkspace.mockReset();
    mocks.startWorkspaceSync.mockReset();
    mocks.stopWorkspaceSync.mockReset();
    mocks.getSession.mockReset();
    mocks.onAuthStateChange.mockReset();
    mocks.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
  });

  afterEach(() => cleanup());

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
});

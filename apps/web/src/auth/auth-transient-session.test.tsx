import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WEB-05. `AuthProvider` returned `loading` INSTEAD of `children`, so any auth
 * state change tore the whole React subtree down — and
 * `recoverTransientSession()` sets state to 'loading' on every empty-session
 * event, which Supabase emits on token refresh and when a mobile browser
 * resumes a suspended tab. A user half-way through the payroll wizard lost
 * every typed value to a blip that recovers in 1.5 s.
 *
 * The assertion that matters is not "a spinner appears". It is that the
 * component state underneath survives.
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
  refreshSession: vi.fn(),
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
      refreshSession: mocks.refreshSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signOut: vi.fn(),
    },
  }),
}));

import { AuthProvider } from './auth-context.js';

const USER = { id: 'user-synthetic-001' };

/** Stands in for a long form: it holds state that a remount would destroy. */
function TypedForm() {
  const [value, setValue] = useState('');
  return (
    <label>
      שכר בסיס
      <input value={value} onChange={(event) => setValue(event.target.value)} />
    </label>
  );
}

function renderGate() {
  return render(
    <AuthProvider
      login={<p>מסך כניסה</p>}
      configurationRequired={<p>נדרשת הגדרה</p>}
      storageUnavailable={<p>לא ניתן לטעון את הנתונים המאובטחים</p>}
      passwordRecovery={<p>שחזור סיסמה</p>}
      loading={<p>טוענים</p>}
      sessionRecovering={<p>מתחדש החיבור לחשבון</p>}
    >
      <TypedForm />
    </AuthProvider>,
  );
}

function emitAuthEvent(event: string, session: unknown) {
  const handler = mocks.onAuthStateChange.mock.calls[0]?.[0] as
    ((event: string, session: unknown) => void) | undefined;
  expect(handler).toBeTypeOf('function');
  handler?.(event, session);
}

describe('transient session blip', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.prewarmApi.mockResolvedValue(undefined);
    mocks.flushWorkspaceSync.mockResolvedValue(true);
    mocks.startWorkspaceSync.mockResolvedValue(undefined);
    mocks.canUseCachedWorkspace.mockReturnValue(false);
    mocks.getSession.mockResolvedValue({ data: { session: { user: USER } } });
    mocks.refreshSession.mockResolvedValue({ data: { session: null } });
    mocks.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps in-progress form state when Supabase reports a momentary null session', async () => {
    renderGate();
    await waitFor(() => expect(screen.getByLabelText('שכר בסיס')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('שכר בסיס'), { target: { value: '8500' } });
    expect(screen.getByLabelText('שכר בסיס')).toHaveValue('8500');

    // The blip: a token refresh surfaces an empty session.
    emitAuthEvent('TOKEN_REFRESHED', null);

    await waitFor(() => expect(screen.getByText('מתחדש החיבור לחשבון')).toBeInTheDocument());
    // The whole point: the field is still mounted and still holds the value.
    expect(screen.getByLabelText('שכר בסיס')).toHaveValue('8500');
  });

  it('still shows the full loading screen on a cold start, when there is nothing to preserve', () => {
    // getSession has not resolved yet, so nothing has ever been mounted.
    mocks.getSession.mockReturnValue(new Promise(() => undefined));
    renderGate();

    expect(screen.getByText('טוענים')).toBeInTheDocument();
    expect(screen.queryByLabelText('שכר בסיס')).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  retryWorkspaceSync: vi.fn(),
}));

vi.mock('./auth/auth-context.js', () => ({
  useAuth: () => ({
    enabled: true,
    signOut: vi.fn(),
  }),
}));

vi.mock('./storage/workspace-sync.js', () => ({
  getWorkspaceSyncState: () => 'error',
  retryWorkspaceSync: mocks.retryWorkspaceSync,
  WORKSPACE_SYNC_CHANGED: 'caredesk:workspace-sync-changed',
}));

import { AppShell } from './AppShell.js';

describe('AppShell cloud save recovery', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.retryWorkspaceSync.mockReset();
  });

  it('retries without telling the user to reload and lose local edits', () => {
    render(
      <MemoryRouter>
        <AppShell>
          <p>תוכן בדיקה</p>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('השמירה בענן נכשלה');
    expect(screen.queryByText(/לרענן/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'נסו שוב' }));

    expect(mocks.retryWorkspaceSync).toHaveBeenCalledTimes(1);
  });
});

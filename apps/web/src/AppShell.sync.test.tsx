import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';

const mocks = vi.hoisted(() => ({
  state: 'error' as string,
  canWrite: true as boolean,
  retryWorkspaceSync: vi.fn(),
  resolveWorkspaceConflict: vi.fn(),
  resolveWorkspaceShrink: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('./auth/auth-context.js', () => ({
  useAuth: () => ({
    enabled: true,
    canWrite: mocks.canWrite,
    signOut: mocks.signOut,
  }),
}));

vi.mock('./storage/workspace-sync.js', () => ({
  getWorkspaceSyncState: () => mocks.state,
  retryWorkspaceSync: mocks.retryWorkspaceSync,
  resolveWorkspaceConflict: mocks.resolveWorkspaceConflict,
  resolveWorkspaceShrink: mocks.resolveWorkspaceShrink,
  WORKSPACE_SYNC_CHANGED: 'caredesk:workspace-sync-changed',
}));

import { AppShell } from './AppShell.js';

function renderShell() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <MemoryRouter>
        <AppShell>
          <p>תוכן בדיקה</p>
        </AppShell>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('AppShell cloud save recovery', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.state = 'error';
    mocks.canWrite = true;
    mocks.retryWorkspaceSync.mockReset();
    mocks.resolveWorkspaceConflict.mockReset().mockResolvedValue(undefined);
    mocks.resolveWorkspaceShrink.mockReset().mockResolvedValue(undefined);
    mocks.signOut.mockReset().mockResolvedValue('ok');
  });

  it('retries without telling the user to reload and lose local edits', () => {
    renderShell();

    expect(screen.getByRole('alert')).toHaveTextContent('השמירה בענן נכשלה');
    expect(screen.queryByText(/לרענן/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'נסו שוב' }));

    expect(mocks.retryWorkspaceSync).toHaveBeenCalledTimes(1);
  });

  /**
   * UI-WRITE-01. A cross-device conflict is not something a retry can fix.
   * The alert offers the two real options and nothing else.
   */
  it('offers keep-remote / keep-local on a cross-device conflict instead of a futile retry', async () => {
    mocks.state = 'conflict';
    renderShell();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('התיק עודכן ממכשיר אחר');
    expect(screen.queryByRole('button', { name: 'נסו שוב' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'לטעון את הגרסה מהשרת' }));
    expect(mocks.resolveWorkspaceConflict).toHaveBeenCalledWith('keep-remote');

    // Both buttons are disabled while a choice is being applied.
    const keepLocal = screen.getByRole('button', { name: 'לשמור את הגרסה מהמכשיר הזה' });
    await waitFor(() => expect(keepLocal).toBeEnabled());
    fireEvent.click(keepLocal);
    expect(mocks.resolveWorkspaceConflict).toHaveBeenCalledWith('keep-local');
  });

  /** UI-WRITE-05. A refused shrink is confirmed or undone, in the customer's words. */
  it('offers confirm / undo when the server refuses a near-empty save', async () => {
    mocks.state = 'shrink-blocked';
    renderShell();

    expect(screen.getByRole('alert')).toHaveTextContent('השרת עצר שמירה שמוחקת את רוב המידע');

    fireEvent.click(screen.getByRole('button', { name: 'בטל ושחזר מהשרת' }));
    expect(mocks.resolveWorkspaceShrink).toHaveBeenCalledWith('undo');

    const confirm = screen.getByRole('button', { name: 'כן, למחוק מכל המכשירים' });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    expect(mocks.resolveWorkspaceShrink).toHaveBeenCalledWith('confirm');
  });

  /** GAP-2-01. Access is gone; a retry button would be a lie. */
  it('names a revoked access without offering a retry', () => {
    mocks.state = 'unauthorized';
    renderShell();

    expect(screen.getByRole('alert')).toHaveTextContent('אין לך עוד גישה לתיק זה');
    expect(screen.queryByRole('button', { name: 'נסו שוב' })).not.toBeInTheDocument();
  });

  /** GAP-2-03. A viewer's refused edit is explained, not retried. */
  it('explains a refused edit for a read-only member', () => {
    mocks.state = 'read-only';
    renderShell();

    expect(screen.getByRole('alert')).toHaveTextContent('אין לך הרשאת עריכה בתיק זה');
    expect(screen.queryByRole('button', { name: 'נסו שוב' })).not.toBeInTheDocument();
  });

  it('shows a persistent view-only notice for a viewer', () => {
    mocks.state = 'saved';
    mocks.canWrite = false;
    renderShell();

    const notice = screen.getByText('צפייה בלבד — אין לך הרשאה לערוך את התיק.');
    expect(notice).toHaveAttribute('role', 'status');
    // Informative, not alarming: the ordinary "saved" indicator stays as well.
    expect(screen.getByText('נשמר בענן')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  /**
   * SEC-WEB-01. A sign-out that is refused because of unsaved edits is said out
   * loud, with the choice to retry or to leave anyway.
   */
  it('shows the refused sign-out and lets the customer leave anyway', async () => {
    mocks.state = 'saved';
    mocks.signOut.mockResolvedValueOnce('unsaved-changes').mockResolvedValueOnce('ok');
    renderShell();

    fireEvent.click(screen.getByRole('button', { name: 'יציאה' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('יש שינויים שעוד לא נשמרו בענן');
    expect(screen.getByRole('button', { name: 'נסו שוב' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'צאו בכל זאת — שינויים שלא נשמרו יאבדו' }));

    await waitFor(() => expect(mocks.signOut).toHaveBeenLastCalledWith({ discardUnsaved: true }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

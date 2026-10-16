import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import {
  captureMvpWorkspace,
  createMvpClient,
  MVP_PROFILE_CHANGED,
  readMvpClients,
} from '../storage/mvp-storage.js';

vi.mock('../auth/auth-context.js', () => ({
  useAuth: () => ({
    enabled: true,
    canWrite: true,
    lastSignOut: null,
    signOut: vi.fn(async () => 'ok'),
  }),
}));

import { CLIENT_DELETE_UNDO_MS, ClientsPage } from './ClientsPage.js';

function renderPage() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <MemoryRouter initialEntries={['/app']}>
        <ClientsPage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

/** Opens the card's "more actions" and presses delete. */
function pressDelete() {
  const details = document.querySelector<HTMLDetailsElement>('details.client-more-actions');
  expect(details).not.toBeNull();
  details!.open = true;
  fireEvent.click(screen.getByRole('button', { name: 'מחיקת התיק' }));
}

describe('ClientsPage', () => {
  let confirmSpy: MockInstance<typeof window.confirm>;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    confirmSpy = vi.spyOn(window, 'confirm');
  });

  afterEach(() => {
    confirmSpy.mockRestore();
    vi.useRealTimers();
  });

  /**
   * UI-NAV-01 (defence in depth). The list was read once on mount. When the
   * page mounts against an empty cache and hydration fills it a moment later,
   * the cards must appear without a reload.
   */
  it('refreshes the list when hydration replaces the workspace', async () => {
    renderPage();
    expect(screen.getByText('עדיין אין תיקי העסקה')).toBeInTheDocument();

    act(() => {
      createMvpClient();
      window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));
    });

    expect(await screen.findByRole('heading', { level: 2, name: 'תיק חדש' })).toBeInTheDocument();
  });

  /**
   * UI-WRITE-05. The old confirmation spoke of "local data" while the delete
   * reached every family device within 250 ms.
   */
  it('names the cross-device scope and asks twice before deleting', () => {
    createMvpClient();
    confirmSpy.mockReturnValue(true);
    renderPage();

    pressDelete();

    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(String(confirmSpy.mock.calls[0]?.[0])).toMatch(/מכל המכשירים של המשפחה/);
    expect(String(confirmSpy.mock.calls[0]?.[0])).not.toMatch(/הנתונים המקומיים/);
    expect(String(confirmSpy.mock.calls[1]?.[0])).toMatch(/אישור אחרון/);
    expect(readMvpClients()).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('נמחק');
  });

  it('does nothing when the second confirmation is declined', () => {
    createMvpClient();
    confirmSpy.mockReturnValueOnce(true).mockReturnValueOnce(false);
    renderPage();

    pressDelete();

    expect(readMvpClients()).toHaveLength(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('restores the employer and its records when undo is pressed within the window', async () => {
    const client = createMvpClient();
    // An employer-scoped record, the way tasks and payroll are keyed.
    const taskKey = `caredesk.mvp.tasks.v1.client.${client.id}`;
    localStorage.setItem(taskKey, '[{"id":"t-1","title":"משימה"}]');
    confirmSpy.mockReturnValue(true);
    renderPage();

    pressDelete();
    expect(localStorage.getItem(taskKey)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'בטל מחיקה' }));

    await waitFor(() => expect(readMvpClients()).toHaveLength(1));
    expect(readMvpClients()[0]?.id).toBe(client.id);
    // Restored through the encrypted business cache, so read it back decrypted.
    expect(captureMvpWorkspace().entries[taskKey]).toBe('[{"id":"t-1","title":"משימה"}]');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'תיק חדש' })).toBeInTheDocument();
  });

  it('withdraws the undo after the window closes', () => {
    vi.useFakeTimers();
    createMvpClient();
    confirmSpy.mockReturnValue(true);
    renderPage();

    pressDelete();
    expect(screen.getByRole('button', { name: 'בטל מחיקה' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(CLIENT_DELETE_UNDO_MS + 1);
    });

    expect(screen.queryByRole('button', { name: 'בטל מחיקה' })).not.toBeInTheDocument();
    expect(readMvpClients()).toHaveLength(0);
  });
});

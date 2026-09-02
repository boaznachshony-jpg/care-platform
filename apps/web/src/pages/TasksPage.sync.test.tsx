import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { saveMvpTasks } from '../storage/mvp-storage.js';

/**
 * Sync-specific coverage for TasksPage, kept separate from TasksPage.test.tsx
 * so the plain local-storage behaviour tests there are never affected by
 * mocking `../api/client.js` and `../canonical-case.js` here.
 */
const mocks = vi.hoisted(() => ({
  findCanonicalCase: vi.fn(),
  importCaseTask: vi.fn(),
  listCaseTasks: vi.fn(),
  completeCaseTask: vi.fn(),
  archiveCaseTask: vi.fn(),
  updateCaseTask: vi.fn(),
  listEmploymentCases: vi.fn(),
}));

vi.mock('../canonical-case.js', () => ({
  findCanonicalCase: mocks.findCanonicalCase,
  LEGACY_UNSCOPED_CLIENT_ID: 'legacy:unscoped',
}));

vi.mock('../api/client.js', () => ({
  importCaseTask: mocks.importCaseTask,
  listCaseTasks: mocks.listCaseTasks,
  completeCaseTask: mocks.completeCaseTask,
  archiveCaseTask: mocks.archiveCaseTask,
  updateCaseTask: mocks.updateCaseTask,
  // Defect 4: useCaseForLegacyClient calls this to decide whether the
  // unscoped sentinel route is ambiguous (more than one client on the
  // account). Defaulting to a single case here keeps every pre-existing test
  // below on the 'found' path it always resolved to.
  listEmploymentCases: mocks.listEmploymentCases,
}));

import { TasksPage } from './TasksPage.js';

const DEMO_CASE = { id: 'case-demo-001' };

function renderPage() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <TasksPage />
    </I18nextProvider>,
  );
}

describe('TasksPage sync', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.findCanonicalCase.mockReset();
    mocks.importCaseTask.mockReset();
    mocks.listCaseTasks.mockReset();
    mocks.completeCaseTask.mockReset();
    mocks.archiveCaseTask.mockReset();
    mocks.updateCaseTask.mockReset();
    mocks.listEmploymentCases.mockReset();
    mocks.findCanonicalCase.mockResolvedValue(DEMO_CASE);
    mocks.listCaseTasks.mockResolvedValue([]);
    mocks.listEmploymentCases.mockResolvedValue([DEMO_CASE]);
  });

  it('uploads a local task through the idempotent import endpoint exactly once, not on every render', async () => {
    saveMvpTasks([
      {
        id: 'local-1',
        title: 'משימה מקומית',
        dueDate: '2026-09-10',
        priority: 'important',
        status: 'open',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
    mocks.importCaseTask.mockResolvedValue({
      id: 'server-1',
      title: 'משימה מקומית',
      titleKey: null,
      description: null,
      status: 'open',
      priority: 'high',
      dueAt: '2026-09-10T00:00:00.000Z',
      completedAt: null,
      sourceType: 'manual',
      legacyLocalId: 'local-1',
    });

    const { rerender } = renderPage();

    await waitFor(() => expect(mocks.importCaseTask).toHaveBeenCalledTimes(1));
    // The known priority mapping: local 'important' uploads as canonical
    // 'high' (see sync/task-mapping.ts) — never the plain create endpoint.
    expect(mocks.importCaseTask).toHaveBeenCalledWith('case-demo-001', {
      legacyLocalId: 'local-1',
      title: 'משימה מקומית',
      priority: 'high',
      dueDate: '2026-09-10',
      status: 'open',
    });

    rerender(
      <I18nextProvider i18n={initI18n()}>
        <TasksPage />
      </I18nextProvider>,
    );
    await waitFor(() => expect(mocks.listCaseTasks).toHaveBeenCalled());
    // Still exactly once: a re-render/re-mount must not re-upload an already
    // uploaded record (idempotency tracked client-side, on top of the
    // server's own idempotent /import — see sync/legacy-upload.ts).
    expect(mocks.importCaseTask).toHaveBeenCalledTimes(1);
  });

  it('shows a retryable, visible failure when an upload fails, and never removes the local task', async () => {
    saveMvpTasks([
      {
        id: 'local-1',
        title: 'משימה שנכשלת',
        dueDate: '2026-09-10',
        priority: 'normal',
        status: 'open',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
    mocks.importCaseTask.mockRejectedValue(new Error('network error'));

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // The task itself is still on screen and still in local storage — a
    // failed upload never rolls back or hides the user's own input.
    expect(screen.getByText('משימה שנכשלת')).toBeInTheDocument();

    mocks.importCaseTask.mockResolvedValue({
      id: 'server-1',
      title: 'משימה שנכשלת',
      titleKey: null,
      description: null,
      status: 'open',
      priority: 'normal',
      dueAt: '2026-09-10T00:00:00.000Z',
      completedAt: null,
      sourceType: 'manual',
      legacyLocalId: 'local-1',
    });
    fireEvent.click(screen.getByRole('button', { name: /נסו שוב|נסה שוב/ }));

    await waitFor(() => expect(mocks.importCaseTask).toHaveBeenCalledTimes(2));
  });

  // Defect 1 (the worst one): an edit to an already-synced task must survive
  // the next sync, and must reach the server via updateCaseTask — not the
  // other way around.
  it('an edit to an already-synced task is pushed via updateCaseTask and survives the merge, instead of being silently reverted', async () => {
    saveMvpTasks([
      {
        id: 'local-1',
        title: 'כותרת מקורית',
        dueDate: '2026-09-10',
        priority: 'normal',
        status: 'open',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
    const serverTask = {
      id: 'server-1',
      title: 'כותרת מקורית',
      titleKey: null,
      description: null,
      status: 'open',
      priority: 'normal',
      dueAt: '2026-09-10T00:00:00.000Z',
      completedAt: null,
      sourceType: 'manual',
      legacyLocalId: 'local-1',
    };
    mocks.importCaseTask.mockResolvedValue(serverTask);
    mocks.listCaseTasks.mockResolvedValue([serverTask]);

    renderPage();
    await waitFor(() => expect(mocks.importCaseTask).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('כותרת מקורית')).toBeInTheDocument());

    // Edit the task on this device. The server mock deliberately keeps
    // returning the *old* title on every subsequent listCaseTasks call — as
    // if the read-back landed before an update, or came from a slightly
    // stale replica — so this proves the merge does not fall back to it.
    mocks.updateCaseTask.mockResolvedValue({ ...serverTask, title: 'כותרת מתוקנת' });
    fireEvent.click(screen.getByRole('button', { name: 'עריכה' }));
    fireEvent.change(screen.getByLabelText('מה צריך לבצע?'), {
      target: { value: 'כותרת מתוקנת' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת המשימה' }));

    await waitFor(() => expect(mocks.updateCaseTask).toHaveBeenCalledTimes(1));
    expect(mocks.updateCaseTask).toHaveBeenCalledWith(
      'case-demo-001',
      'server-1',
      expect.objectContaining({ title: 'כותרת מתוקנת' }),
    );
    // Never reverted to the server's (still-old) copy, on screen or in storage.
    expect(screen.getByText('כותרת מתוקנת')).toBeInTheDocument();
    expect(screen.queryByText('כותרת מקורית')).not.toBeInTheDocument();
  });

  // Defect 5: completing a task must be retryable through the sync pass, not
  // a one-shot fire-and-forget that is lost forever on the first failure.
  it('retries a failed task completion on the next sync pass instead of losing it', async () => {
    saveMvpTasks([
      {
        id: 'local-1',
        title: 'משימה להשלמה',
        dueDate: '2026-09-10',
        priority: 'normal',
        status: 'open',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
    const serverTask = {
      id: 'server-1',
      title: 'משימה להשלמה',
      titleKey: null,
      description: null,
      status: 'open',
      priority: 'normal',
      dueAt: '2026-09-10T00:00:00.000Z',
      completedAt: null,
      sourceType: 'manual',
      legacyLocalId: 'local-1',
    };
    mocks.importCaseTask.mockResolvedValue(serverTask);
    mocks.listCaseTasks.mockResolvedValue([serverTask]);
    mocks.completeCaseTask.mockRejectedValueOnce(new Error('network error'));

    renderPage();
    await waitFor(() => expect(mocks.importCaseTask).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'השלמת משימה להשלמה' }));
    await waitFor(() => expect(mocks.completeCaseTask).toHaveBeenCalledTimes(1));
    // The failed completion is visible and retryable, not silently swallowed.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    mocks.completeCaseTask.mockResolvedValueOnce({ ...serverTask, status: 'completed' });
    fireEvent.click(screen.getByRole('button', { name: /נסו שוב|נסה שוב/ }));

    await waitFor(() => expect(mocks.completeCaseTask).toHaveBeenCalledTimes(2));
    expect(mocks.completeCaseTask).toHaveBeenNthCalledWith(2, 'case-demo-001', 'server-1');
  });

  // Defect 4: an unscoped route must never guess which of an account's
  // multiple clients its records belong to.
  it('refuses to sync at all on the unscoped route when the account has more than one client', async () => {
    mocks.listEmploymentCases.mockResolvedValue([DEMO_CASE, { id: 'case-other-002' }]);
    saveMvpTasks([
      {
        id: 'local-1',
        title: 'משימה בחשבון עם כמה לקוחות',
        dueDate: '2026-09-10',
        priority: 'normal',
        status: 'open',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ]);

    renderPage();

    await waitFor(() => expect(mocks.listEmploymentCases).toHaveBeenCalled());
    // Never guesses which case to sync to.
    expect(mocks.findCanonicalCase).not.toHaveBeenCalled();
    expect(mocks.importCaseTask).not.toHaveBeenCalled();
    // The local task is still shown — refusing to sync never hides local data.
    expect(screen.getByText('משימה בחשבון עם כמה לקוחות')).toBeInTheDocument();
  });

  it('keeps showing the local task list when the server cannot be reached at all', async () => {
    mocks.findCanonicalCase.mockRejectedValue(new Error('offline'));
    saveMvpTasks([
      {
        id: 'local-1',
        title: 'משימה בלי חיבור',
        dueDate: '2026-09-10',
        priority: 'normal',
        status: 'open',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ]);

    renderPage();

    expect(screen.getByText('משימה בלי חיבור')).toBeInTheDocument();
    expect(mocks.importCaseTask).not.toHaveBeenCalled();
  });
});

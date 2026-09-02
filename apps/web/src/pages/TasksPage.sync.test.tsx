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
    mocks.findCanonicalCase.mockResolvedValue(DEMO_CASE);
    mocks.listCaseTasks.mockResolvedValue([]);
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

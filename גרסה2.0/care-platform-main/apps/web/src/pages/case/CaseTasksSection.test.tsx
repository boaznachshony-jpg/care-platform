import { render, screen, waitFor, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { initI18n } from '@caredesk/i18n';
import { CaseTasksSection } from './CaseTasksSection.js';

function renderSection() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <CaseTasksSection caseId="case-1" />
    </I18nextProvider>,
  );
}

describe('CaseTasksSection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('with no tasks', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }),
      );
    });

    it('shows the empty state in Hebrew from i18n', async () => {
      renderSection();
      await waitFor(() => {
        expect(screen.getByText('אין משימות פתוחות בתיק.')).toBeInTheDocument();
      });
    });

    it('has no detectable accessibility violations', async () => {
      const { container } = renderSection();
      await waitFor(() => screen.getByText('אין משימות פתוחות בתיק.'));
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe('with tasks', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 'task-1',
                title: 'חידוש אשרה',
                titleKey: null,
                description: null,
                status: 'open',
                priority: 'high',
                dueAt: '2026-09-01T00:00:00.000Z',
                completedAt: null,
                sourceType: 'manual',
              },
            ]),
        }),
      );
    });

    it('renders the task with translated status and priority, and a plain due date', async () => {
      renderSection();
      await waitFor(() => expect(screen.getByText('חידוש אשרה')).toBeInTheDocument());

      // Scoped to the list: the priority words also appear as <select> options.
      const item = screen.getByRole('listitem');
      expect(within(item).getByText('פתוחה')).toBeInTheDocument();
      expect(within(item).getByText('גבוהה')).toBeInTheDocument();
      // Date shown as the stored calendar day, not a timezone-shifted rendering.
      expect(within(item).getByText('2026-09-01')).toBeInTheDocument();
    });

    it('offers a complete action for an open task', async () => {
      renderSection();
      await waitFor(() => expect(screen.getByText('חידוש אשרה')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'סימון כהושלם' })).toBeInTheDocument();
    });
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { CaseTimelineSection } from './CaseTimelineSection.js';

// Constitution §16: synthetic data only.
const DEMO_CASE_ID = 'case-demo-001';

function renderSection(caseId = DEMO_CASE_ID) {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <CaseTimelineSection caseId={caseId} />
    </I18nextProvider>,
  );
}

describe('CaseTimelineSection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('empty state', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }),
      );
    });

    it('shows the section heading', async () => {
      renderSection();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'ציר זמן' })).toBeInTheDocument(),
      );
    });

    it('shows empty state when no events', async () => {
      renderSection();
      await waitFor(() => expect(screen.getByText('אין עדיין אירועים בתיק.')).toBeInTheDocument());
    });
  });

  describe('with timeline events', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 'evt-001',
                eventType: 'case.opened',
                summaryKey: 'timeline.case.opened.summary',
                actorKind: 'employer',
                actorId: 'emp-001',
                occurredAt: '2026-08-01T10:00:00.000Z',
                metadata: {},
              },
            ]),
        }),
      );
    });

    it('renders a list of timeline events', async () => {
      renderSection();
      await waitFor(() => expect(screen.getByRole('list')).toBeInTheDocument());
    });

    it('displays the translated event summary', async () => {
      renderSection();
      await waitFor(() => expect(screen.getByText('תיק ההעסקה נפתח')).toBeInTheDocument());
    });
  });

  describe('timestamps', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 'evt-002',
                eventType: 'task.created',
                summaryKey: 'timeline.task.created.summary',
                actorKind: 'employer',
                actorId: 'emp-001',
                // 22:30 UTC on the 14th is 01:30 on the 15th in Israel (IDT).
                occurredAt: '2026-08-14T22:30:00.000Z',
                metadata: {},
              },
            ]),
        }),
      );
    });

    it('renders the Israel wall clock, day-first, not the UTC ISO string', async () => {
      renderSection();
      expect(await screen.findByText('15.08.2026, 01:30')).toBeInTheDocument();
      expect(screen.queryByText(/2026-08-14/)).toBeNull();
      // The machine-readable value keeps full precision for assistive tech.
      expect(screen.getByText('15.08.2026, 01:30')).toHaveAttribute(
        'dateTime',
        '2026-08-14T22:30:00.000Z',
      );
    });
  });

  /**
   * A failed fetch used to be caught as `setEvents([])`, so a 500 or a 403
   * rendered "אין עדיין אירועים בתיק." — a case with no history, on the one
   * screen meant to prove what was done and when.
   */
  describe('when the timeline cannot be loaded', () => {
    const LOAD_FAILED = 'לא ניתן היה לטעון את ציר הזמן. הנתונים לא נפגעו — נסו לרענן את הדף.';

    it.each([500, 403])('shows an error, never the empty state, on HTTP %i', async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status, json: () => Promise.resolve({}) }),
      );
      renderSection();
      expect(await screen.findByText(LOAD_FAILED)).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(LOAD_FAILED);
      expect(screen.queryByText('אין עדיין אירועים בתיק.')).toBeNull();
    });
  });
});

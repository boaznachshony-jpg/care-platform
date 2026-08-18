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
});

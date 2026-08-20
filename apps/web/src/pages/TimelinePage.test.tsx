import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { listCaseTimeline } from '../api/client.js';
import { TimelinePage } from './TimelinePage.js';

vi.mock('../api/client.js', () => ({ listCaseTimeline: vi.fn() }));
const renderPage = () =>
  render(
    <I18nextProvider i18n={initI18n()}>
      <MemoryRouter initialEntries={['/clients/11111111-1111-4111-8111-111111111111/timeline']}>
        <Routes>
          <Route path="/clients/:clientId/timeline" element={<TimelinePage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );

describe('TimelinePage canonical API projection', () => {
  beforeEach(() => vi.mocked(listCaseTimeline).mockReset());
  it('shows the canonical empty state without fabricating deadlines', async () => {
    vi.mocked(listCaseTimeline).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('אין כרגע אירועים להצגה.')).toBeVisible();
  });
  it('always shows the upcoming payment obligations above the events', async () => {
    vi.mocked(listCaseTimeline).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByRole('heading', { name: 'תשלומים קרובים' })).toBeVisible();
    expect(screen.getByText('תשלום השכר הקרוב')).toBeVisible();
    expect(screen.getByText('תשלום דמי ביטוח לאומי (רבעוני)')).toBeVisible();
    expect(screen.getByRole('link', { name: 'לתשלום באתר הביטוח הלאומי' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
  });
  it('renders a canonical event and explains the Audit separation', async () => {
    vi.mocked(listCaseTimeline).mockResolvedValue([
      {
        id: 'event-1',
        eventTypeKey: 'payroll.month_closed',
        summaryKey: 'Payroll month closed.',
        occurredAt: '2026-08-15T12:00:00.000Z',
        actorDisplay: null,
        sensitivity: 'financial_sensitive',
        actionTarget: '/payroll',
      },
    ]);
    renderPage();
    expect(await screen.findByText('Payroll month closed.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'פתיחת הפעולה' })).toHaveAttribute(
      'href',
      '/clients/11111111-1111-4111-8111-111111111111/payroll',
    );
    expect(screen.getByText(/פרטי אבטחה וספקים נשמרים בנפרד/)).toBeVisible();
  });
});

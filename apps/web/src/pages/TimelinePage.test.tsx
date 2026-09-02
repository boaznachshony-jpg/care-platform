import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { listCaseTimeline } from '../api/client.js';
import type { CaseLookupState } from '../sync/use-case-for-legacy-client.js';
import { TimelinePage } from './TimelinePage.js';

vi.mock('../api/client.js', () => ({ listCaseTimeline: vi.fn() }));

// `useCaseForLegacyClient` is the shared canonical-case lookup already used by
// Tasks/Documents/Medications; mocking it directly here lets each test drive
// the four lookup outcomes deterministically instead of depending on a real
// network round trip through `findCanonicalCase`.
const mockUseCaseForLegacyClient = vi.fn<(legacyClientId: string) => CaseLookupState>();
vi.mock('../sync/use-case-for-legacy-client.js', () => ({
  useCaseForLegacyClient: (legacyClientId: string) => mockUseCaseForLegacyClient(legacyClientId),
}));

const CANONICAL_CASE_ID = 'case-canonical-abc';
const LEGACY_CLIENT_ID = '11111111-1111-4111-8111-111111111111';

const renderPage = () =>
  render(
    <I18nextProvider i18n={initI18n()}>
      <MemoryRouter initialEntries={[`/clients/${LEGACY_CLIENT_ID}/timeline`]}>
        <Routes>
          <Route path="/clients/:clientId/timeline" element={<TimelinePage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );

describe('TimelinePage canonical API projection', () => {
  beforeEach(() => {
    vi.mocked(listCaseTimeline).mockReset();
    mockUseCaseForLegacyClient.mockReset();
    mockUseCaseForLegacyClient.mockReturnValue({ status: 'found', caseId: CANONICAL_CASE_ID });
  });

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
      `/clients/${LEGACY_CLIENT_ID}/payroll`,
    );
    expect(screen.getByText(/פרטי אבטחה וספקים נשמרים בנפרד/)).toBeVisible();
  });

  /**
   * The bug: this screen used to pass the route's legacy CLIENT id straight
   * to `listCaseTimeline`, which is keyed on the canonical EMPLOYMENT CASE id
   * — every request 404'd against `/cases/:caseId`. It did have a `.catch`,
   * so it was not silent, but it showed "לא ניתן לטעון..." permanently, even
   * for a normal case with a real timeline.
   */
  it('sends the resolved canonical case id, never the legacy route id, to listCaseTimeline', async () => {
    vi.mocked(listCaseTimeline).mockResolvedValue([]);
    renderPage();
    await screen.findByText('אין כרגע אירועים להצגה.');
    expect(listCaseTimeline).toHaveBeenCalledWith(CANONICAL_CASE_ID);
    expect(listCaseTimeline).not.toHaveBeenCalledWith(LEGACY_CLIENT_ID);
  });

  it('shows a loading state while the canonical case is being resolved, without calling the API', () => {
    mockUseCaseForLegacyClient.mockReturnValue({ status: 'checking' });
    renderPage();
    expect(screen.getByText('טוען…')).toBeVisible();
    expect(listCaseTimeline).not.toHaveBeenCalled();
  });

  /**
   * A customer who has not opened a case yet is a real, distinct state — not
   * an error and not an empty timeline for an existing case.
   */
  it('shows a distinct no-case state instead of the generic failure or the empty-events state', () => {
    mockUseCaseForLegacyClient.mockReturnValue({ status: 'none' });
    renderPage();
    expect(
      screen.getByText('עדיין לא נפתח תיק העסקה קנוני — ציר הזמן יופיע לאחר פתיחתו.'),
    ).toBeVisible();
    expect(screen.queryByText('אין כרגע אירועים להצגה.')).not.toBeInTheDocument();
    expect(screen.queryByText('לא ניתן לטעון את ציר הזמן הקנוני.')).not.toBeInTheDocument();
    expect(listCaseTimeline).not.toHaveBeenCalled();
  });

  it('tells a lookup failure apart from a real API failure', () => {
    mockUseCaseForLegacyClient.mockReturnValue({ status: 'unavailable' });
    renderPage();
    expect(
      screen.getByText('לא ניתן להתחבר לשרת כדי לאתר את התיק כרגע. נסו שוב בעוד רגע.'),
    ).toBeVisible();
    expect(listCaseTimeline).not.toHaveBeenCalled();
  });

  it('shows the failure message when the timeline call itself fails for a resolved case', async () => {
    vi.mocked(listCaseTimeline).mockRejectedValue(new Error('network down'));
    renderPage();
    expect(await screen.findByText('לא ניתן לטעון את ציר הזמן הקנוני.')).toBeVisible();
  });
});

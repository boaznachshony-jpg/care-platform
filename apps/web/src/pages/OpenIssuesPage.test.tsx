import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { OpenIssuesPage } from './OpenIssuesPage.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

// Constitution §16: synthetic data only.
const mockProfile = {
  caregiverName: 'אנה פטרוב',
  caregiverCountry: 'אוקראינה',
  caregiverLanguage: 'אוקראינית',
  employmentStartDate: '2026-01-15',
  employerName: 'בועז בדיקה',
  recipientName: 'מטופל בדיקה',
  employerIdNumber: '123456782',
  employerPhone: '0501234567',
  representativeName: 'נציג בדיקה',
  representativePhone: '0521234567',
  licensedBureauName: 'תאגיד בדיקה',
  licensedBureauRegistrationNumber: 'LB-1001',
  licensedBureauContactName: 'איש קשר תאגיד',
  licensedBureauContactPhone: '0531234567',
  licensedBureauContactEmail: 'bureau@example.test',
  baseSalary: 7000,
  // Missing on purpose: becomes the single missing-fields issue.
  saturdayRate: 0,
  salaryEffectiveDate: '2026-01-15',
  licenseRenewalDate: inDays(200),
  visaRenewalDate: inDays(5),
  notificationsEnabled: true,
  reminderLeadDays: 7,
  quietHoursStart: '21:00',
  quietHoursEnd: '08:00',
  onboardingCompleted: true,
  employmentAgreementConfirmed: true,
  medicalInsuranceConfirmed: true,
  medicalInsuranceExpiryDate: inDays(20),
};

const mockGetCaseHealth = vi.fn();

// A vi.fn() (not a bare arrow function) so a single test can swap in a
// realistic /clients/:clientId-prefixing implementation to prove the health
// factor's actionTarget bypasses it (see the "does not run the API's
// actionTarget through the client-scoped path()" test below).
const mockClientPath = vi.hoisted(() => vi.fn((path: string = '/') => path));

vi.mock('../hooks/use-mvp-profile.js', () => ({
  useMvpProfile: () => [mockProfile, vi.fn()],
}));

vi.mock('../hooks/use-client-path.js', () => ({
  useClientPath: () => mockClientPath,
}));

vi.mock('../api/client.js', () => ({
  getCaseHealth: (...args: unknown[]) => mockGetCaseHealth(...args),
}));

// Deterministic upcoming payments: salary inside the 30-day window, the
// quarterly National Insurance payment outside it.
vi.mock('../upcoming-payments.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../upcoming-payments.js')>();
  return {
    ...actual,
    createUpcomingPayments: () => [
      { id: 'salary' as const, dueDate: '2026-09-09', daysRemaining: 8 },
      {
        id: 'nationalInsurance' as const,
        dueDate: '2026-10-15',
        daysRemaining: 44,
        externalUrl: actual.NATIONAL_INSURANCE_PAYMENT_URL,
      },
    ],
  };
});

/**
 * Tests inject their own openIssues bundle so they stay deterministic while
 * the shared he.json/en.json files are updated in a separate change.
 */
const openIssuesHe = {
  eyebrow: 'תמונת מצב',
  title: 'נושאים פתוחים במבט אחד',
  summary: 'ריכוז של כל מה שדורש טיפול בתיק ההעסקה, לפי דחיפות.',
  status: { urgent: 'דורש טיפול מיידי', soon: 'כדאי לטפל בקרוב', ok: 'הכול תקין' },
  countsTitle: 'סיכום לפי דחיפות',
  buckets: { urgent: 'דחוף', soon: 'בקרוב', ok: 'תקין' },
  scoreLabel: 'ציון {{score}} מתוך 100',
  healthTitle: 'מדד שלמות התיק',
  healthDisclaimer: 'מדד שלמות המבוסס על המידע בתיק; אינו אישור לעמידה בדין.',
  empty: {
    urgent: 'אין נושאים דחופים לטיפול',
    soon: 'אין נושאים שממתינים לטיפול קרוב',
    ok: 'עדיין אין נושאים תקינים להצגה',
  },
  missingTitle: 'חסרים {{count}} פרטים חיוניים',
  completeInSettings: 'השלמה בהגדרות',
  reviewDates: 'בדיקת התאריכים',
  expiresInDays: 'פג תוקף בעוד {{count}} ימים',
  expiredDaysAgo: 'פג תוקף לפני {{count}} ימים',
  dates: {
    visa: 'תוקף אשרת העבודה',
    license: 'תוקף רישיון ההעסקה',
    insurance: 'תוקף הביטוח הרפואי',
  },
  fields: {
    employerName: 'שם המעסיק',
    recipientName: 'שם המטופל',
    caregiverName: 'שם המטפל או המטפלת',
    employmentStartDate: 'תאריך תחילת ההעסקה',
    representativeName: 'שם המורשה',
    licensedBureauName: 'שם הלשכה הפרטית',
    licensedBureauContactName: 'איש הקשר בלשכה',
    licensedBureauContactPhone: 'טלפון איש הקשר בלשכה',
    employmentAgreementConfirmed: 'אישור הסכם ההעסקה',
    medicalInsurance: 'ביטוח רפואי בתוקף',
    baseSalary: 'שכר בסיס',
    saturdayRate: 'תעריף שבת',
    licenseRenewalDate: 'תאריך חידוש הרישיון',
    visaRenewalDate: 'תאריך חידוש האשרה',
  },
  demoBanner: 'תצוגת הדגמה — נתונים לדוגמה בלבד',
  demoDetailsTitle: 'פרטי התיק לדוגמה',
  demoRecipient: 'מקבלת הטיפול',
  demoCaregiver: 'המטפלת',
};

const paymentsHe = {
  salaryTitle: 'תשלום השכר הקרוב',
  nationalInsuranceTitle: 'תשלום דמי ביטוח לאומי (רבעוני)',
  dueDate: 'תאריך יעד: {{date}}',
  dueToday: 'המועד הוא היום',
  daysRemaining: 'בעוד {{count}} ימים',
  openPayroll: 'מעבר למסך השכר',
  openTasks: 'מעבר למשימות',
};

function renderPage(clientId = 'client-001') {
  const i18n = initI18n();
  i18n.addResourceBundle(
    'he',
    'translation',
    { openIssues: openIssuesHe, payments: paymentsHe },
    true,
    true,
  );
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/clients/${clientId}/overview`]}>
        <Routes>
          <Route path="/clients/:clientId/overview" element={<OpenIssuesPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('OpenIssuesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientPath.mockImplementation((path: string = '/') => path);
    mockGetCaseHealth.mockResolvedValue({
      score: 85,
      actionsRemaining: 2,
      disclaimer: '',
      factors: [
        {
          id: 'agreement',
          title: 'הסכם העסקה חתום',
          status: 'attention',
          points: 0,
          weight: 10,
          explanation: 'חסר עותק חתום של הסכם ההעסקה בתיק',
          recommendedAction: 'העלאת ההסכם',
          actionTarget: '/documents',
          provenance: { sourceType: 'documents', sourceIds: ['doc-1'] },
        },
        {
          id: 'payroll',
          title: 'תיעוד שכר',
          status: 'good',
          points: 10,
          weight: 10,
          explanation: 'תלושי השכר האחרונים שמורים בתיק',
          provenance: { sourceType: 'payroll', sourceIds: ['pay-1'] },
        },
      ],
    });
  });

  it('shows the page title', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'נושאים פתוחים במבט אחד' })).toBeInTheDocument();
  });

  it('calls getCaseHealth with the clientId from params', async () => {
    renderPage('client-demo-001');
    await waitFor(() => expect(mockGetCaseHealth).toHaveBeenCalledWith('client-demo-001'));
  });

  it('renders an attention health factor as an urgent issue with its action link', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('הסכם העסקה חתום')).toBeInTheDocument());
    const action = screen.getByRole('link', { name: 'העלאת ההסכם' });
    expect(action).toHaveAttribute('href', '/documents');
  });

  it('aggregates missing profile fields into a single soon issue', () => {
    renderPage();
    expect(screen.getByText('חסרים 1 פרטים חיוניים')).toBeInTheDocument();
    expect(screen.getByText('תעריף שבת')).toBeInTheDocument();
  });

  it('marks a visa expiring within 14 days as urgent with a day count', () => {
    renderPage();
    expect(screen.getByText('תוקף אשרת העבודה')).toBeInTheDocument();
    expect(screen.getByText('פג תוקף בעוד 5 ימים')).toBeInTheDocument();
  });

  it('counts issues per severity bucket', async () => {
    const { container } = renderPage();
    // Urgent: attention factor + visa (5 days). Soon: missing field + insurance
    // (20 days) + salary payment (8 days). Ok: good factor + license (200 days).
    await waitFor(() =>
      expect(container.querySelector('.issues-count-urgent strong')?.textContent).toBe('2'),
    );
    expect(container.querySelector('.issues-count-soon strong')?.textContent).toBe('3');
    expect(container.querySelector('.issues-count-ok strong')?.textContent).toBe('2');
  });

  it('surfaces a payment obligation in the soon bucket only when due within 30 days', () => {
    renderPage();
    expect(screen.getByText('תשלום השכר הקרוב')).toBeInTheDocument();
    expect(screen.getByText('תאריך יעד: 09.09.2026 · בעוד 8 ימים')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'מעבר למסך השכר' })).toHaveAttribute(
      'href',
      '/payroll',
    );
    // 44 days away — stays off the open-issues list until it enters the window.
    expect(screen.queryByText('תשלום דמי ביטוח לאומי (רבעוני)')).not.toBeInTheDocument();
  });

  it('shows the health score in the ring', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('85')).toBeInTheDocument());
  });

  /**
   * The API's actionTarget ("/cases/{caseId}#documents") is already an
   * app-rooted path, matched by the top-level `/cases/:caseId` route — not
   * one relative to the client-scoped workspace. Running it through the
   * /clients/:clientId-prefixing path() (as the missing-fields issue below
   * correctly does for '/settings') produced a URL matching no route, so the
   * router's catch-all silently sent the user to /app and the urgent-action
   * button did nothing.
   */
  it('does not run the health factor actionTarget through the client-scoped path()', async () => {
    mockClientPath.mockImplementation((path: string = '/') =>
      path === '/' ? '/clients/client-001' : `/clients/client-001${path}`,
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('הסכם העסקה חתום')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'העלאת ההסכם' })).toHaveAttribute('href', '/documents');
    // A path that path() *should* still touch, for contrast.
    expect(screen.getByRole('link', { name: 'השלמה בהגדרות' })).toHaveAttribute(
      'href',
      '/clients/client-001/settings',
    );
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { createUpcomingPayments, formatDisplayDate } from '../upcoming-payments.js';
import { DashboardPage } from './DashboardPage.js';

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
  saturdayRate: 440,
  salaryEffectiveDate: '2026-01-15',
  licenseRenewalDate: '2027-01-15',
  visaRenewalDate: '2027-06-01',
  notificationsEnabled: true,
  reminderLeadDays: 7,
  quietHoursStart: '21:00',
  quietHoursEnd: '08:00',
  onboardingCompleted: true,
  employmentAgreementConfirmed: true,
  medicalInsuranceConfirmed: true,
  medicalInsuranceExpiryDate: '2027-06-30',
};

const originalProfile = { ...mockProfile };

const mockGetCaseHealth = vi.fn();

vi.mock('../hooks/use-mvp-profile.js', () => ({
  useMvpProfile: () => [mockProfile, vi.fn()],
}));

vi.mock('../hooks/use-client-path.js', () => ({
  useClientPath:
    () =>
    (path: string = '/') =>
      path,
}));

vi.mock('../api/client.js', () => ({
  getCaseHealth: (...args: unknown[]) => mockGetCaseHealth(...args),
}));

function renderPage(clientId = 'client-001') {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <MemoryRouter initialEntries={[`/clients/${clientId}`]}>
        <Routes>
          <Route path="/clients/:clientId" element={<DashboardPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mockProfile, originalProfile);
    mockGetCaseHealth.mockResolvedValue({
      score: 90,
      actionsRemaining: 1,
      factors: [],
    });
  });

  it('shows the greeting with employer name', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /שלום בועז בדיקה/ })).toBeInTheDocument();
  });

  it('shows the eyebrow label', () => {
    renderPage();
    expect(screen.getByText('מרכז הבקרה האישי')).toBeInTheDocument();
  });

  it('shows attention section heading', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'דורש טיפול' })).toBeInTheDocument(),
    );
  });

  it('shows the no-attention-needed message when health factors are all good', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('אין כרגע פעולות נוספות שדורשות טיפול')).toBeInTheDocument(),
    );
  });

  it('calls getCaseHealth with the clientId from params', async () => {
    renderPage('client-demo-001');
    await waitFor(() => expect(mockGetCaseHealth).toHaveBeenCalledWith('client-demo-001'));
  });

  it('always shows the two upcoming payment obligations with the official payment link', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'תשלומים קרובים' })).toBeInTheDocument();
    expect(screen.getByText('תשלום השכר הקרוב')).toBeInTheDocument();
    expect(screen.getByText('תשלום דמי ביטוח לאומי (רבעוני)')).toBeInTheDocument();
    const paymentLink = screen.getByRole('link', { name: 'לתשלום באתר הביטוח הלאומי' });
    expect(paymentLink).toHaveAttribute(
      'href',
      'https://b2b.btl.gov.il/BTL.ILG.Payments/MeshekBaitInfoShort.aspx',
    );
    expect(paymentLink).toHaveAttribute('target', '_blank');
    expect(paymentLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders the section pill tabs with the overview tab active by default', () => {
    renderPage();
    const overviewTab = screen.getByRole('button', { name: 'סקירה' });
    expect(overviewTab).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'תשלומים' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'פרטי תיק' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('activates a tab when it is clicked', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'תשלומים' }));
    expect(screen.getByRole('button', { name: 'תשלומים' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'סקירה' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders every launcher tile as a link to its destination', () => {
    renderPage();
    const payments = createUpcomingPayments();
    const salaryDate = formatDisplayDate(
      payments.find((payment) => payment.id === 'salary')?.dueDate ?? '',
    );
    const insuranceDate = formatDisplayDate(
      payments.find((payment) => payment.id === 'nationalInsurance')?.dueDate ?? '',
    );

    const expectations: Array<[RegExp, string]> = [
      [/^ציון תקינות/, '/overview'],
      [/^נושאים לטיפול/, '/overview'],
      [/^ויזה/, '/settings'],
      [/^ביטוח רפואי/, '/documents'],
      [new RegExp(`^שכר ${salaryDate.replaceAll('.', '\\.')}$`), '/payroll'],
      [new RegExp(`^ביטוח לאומי ${insuranceDate.replaceAll('.', '\\.')}$`), '/tasks'],
      [/^מסמכים/, '/documents'],
      [/^משימות/, '/tasks'],
      [/^ציר זמן צפייה$/, '/timeline'],
      [/^תיק חירום הדפסה מאובטחת$/, '/binder'],
    ];
    for (const [name, href] of expectations) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }
  });

  it('shows the health score in the score tile once loaded, with a fallback before', async () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'ציון תקינות —' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'נושאים לטיפול —' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'ציון תקינות 90' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'נושאים לטיפול 0' })).toBeInTheDocument();
  });

  it('shows the visa and medical insurance dates from the profile', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'ויזה עד 01.06.2027' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ביטוח רפואי 30.06.2027' })).toBeInTheDocument();
  });

  it('shows fallbacks when the visa date is missing and the insurance is not confirmed', () => {
    mockProfile.visaRenewalDate = '';
    mockProfile.medicalInsuranceConfirmed = false;
    renderPage();
    expect(screen.getByRole('link', { name: 'ויזה חסר תאריך' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ביטוח רפואי לא אושר' })).toBeInTheDocument();
  });

  it('shows the document and open task counts from local storage', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'מסמכים 0' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'משימות 0' })).toBeInTheDocument();
  });

  it('counts attention factors in the attention tile', async () => {
    mockGetCaseHealth.mockResolvedValue({
      score: 70,
      actionsRemaining: 2,
      factors: [
        {
          id: 'factor-1',
          title: 'ביטוח רפואי לחידוש',
          explanation: 'יש לחדש את הביטוח',
          status: 'attention',
          provenance: { sourceType: 'documents', sourceIds: ['doc-1'] },
        },
        {
          id: 'factor-2',
          title: 'שכר חודשי',
          explanation: 'תקין',
          status: 'good',
          provenance: { sourceType: 'payroll', sourceIds: ['pay-1'] },
        },
      ],
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'נושאים לטיפול 1' })).toBeInTheDocument(),
    );
  });

  /**
   * R5-05. This line used to read "insurance: medicalInsuranceExpiryDate" — a
   * machine token in a place the customer is asked to act. The source is now
   * named in the interface language; the id stays, because it is the evidence a
   * support call needs.
   */
  it('names the source of an attention item in Hebrew instead of printing its token', async () => {
    mockGetCaseHealth.mockResolvedValue({
      score: 70,
      actionsRemaining: 1,
      factors: [
        {
          id: 'factor-1',
          title: 'ביטוח רפואי לחידוש',
          explanation: 'יש לחדש את הביטוח',
          status: 'attention',
          provenance: { sourceType: 'insurance', sourceIds: ['medicalInsuranceExpiryDate'] },
        },
      ],
    });
    renderPage();

    const line = await screen.findByText(/מקור: ביטוח/);
    expect(line.textContent).toContain('medicalInsuranceExpiryDate');
    expect(line.textContent).not.toContain('insurance:');
  });

  /**
   * The health payload comes from the server, so a source type the interface
   * does not know must degrade to the raw token — never to a leaked
   * translation key on a screen the customer reads.
   */
  it('falls back to the raw source token rather than printing a translation key', async () => {
    mockGetCaseHealth.mockResolvedValue({
      score: 70,
      actionsRemaining: 1,
      factors: [
        {
          id: 'factor-1',
          title: 'משהו חדש',
          explanation: 'מקור שהממשק אינו מכיר',
          status: 'attention',
          provenance: { sourceType: 'something_new', sourceIds: ['id-1'] },
        },
      ],
    });
    renderPage();

    const line = await screen.findByText(/מקור: something_new/);
    expect(line.textContent).not.toContain('valueOrigin.source');
  });
});

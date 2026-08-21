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

  it('renders the stat tiles with score, attention count and payment due dates', async () => {
    renderPage();
    expect(screen.getByText('ציון תקינות')).toBeInTheDocument();
    expect(screen.getByText('נושאים לטיפול')).toBeInTheDocument();
    expect(screen.getByText('תשלום השכר הבא')).toBeInTheDocument();
    expect(screen.getByText('ביטוח לאומי הקרוב')).toBeInTheDocument();

    // Score appears both in the tile and in the score ring once health loads.
    await waitFor(() => expect(screen.getAllByText('90').length).toBeGreaterThanOrEqual(1));
    expect(screen.getByText('0')).toBeInTheDocument();

    for (const payment of createUpcomingPayments()) {
      expect(screen.getByText(formatDisplayDate(payment.dueDate))).toBeInTheDocument();
    }
  });

  it('counts attention factors in the attention stat tile', async () => {
    mockGetCaseHealth.mockResolvedValue({
      score: 70,
      actionsRemaining: 2,
      factors: [
        {
          id: 'factor-1',
          title: 'ביטוח רפואי',
          explanation: 'יש לחדש את הביטוח',
          status: 'attention',
          provenance: { sourceType: 'documents', sourceIds: ['doc-1'] },
        },
        {
          id: 'factor-2',
          title: 'שכר',
          explanation: 'תקין',
          status: 'good',
          provenance: { sourceType: 'payroll', sourceIds: ['pay-1'] },
        },
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
  });
});

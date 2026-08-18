import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeePage } from './EmployeePage.js';

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
  representativeName: '',
  representativePhone: '',
  licensedBureauName: '',
  licensedBureauRegistrationNumber: '',
  licensedBureauContactName: '',
  licensedBureauContactPhone: '',
  licensedBureauContactEmail: '',
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

const mockSetProfile = vi.fn();

vi.mock('../hooks/use-mvp-profile.js', () => ({
  useMvpProfile: () => [mockProfile, mockSetProfile],
}));

vi.mock('../hooks/use-client-path.js', () => ({
  useClientPath:
    () =>
    (path: string = '/') =>
      path,
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <EmployeePage />
    </MemoryRouter>,
  );
}

describe('EmployeePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the caregiver name as the page heading', () => {
    renderPage();
    // Name appears in both h1 and h2 — use getAllByRole
    const headings = screen.getAllByRole('heading', { name: 'אנה פטרוב' });
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });

  it('shows the eyebrow label', () => {
    renderPage();
    expect(screen.getByText('מטפל או מטפלת')).toBeInTheDocument();
  });

  it('displays caregiver country and employment start date', () => {
    renderPage();
    expect(screen.getByText(/אוקראינה/)).toBeInTheDocument();
    expect(screen.getByText(/2026-01-15/)).toBeInTheDocument();
  });

  it('displays caregiver language preference', () => {
    renderPage();
    expect(screen.getByText(/אוקראינית/)).toBeInTheDocument();
  });

  it('shows the initials avatar', () => {
    renderPage();
    // First two initials of "אנה פטרוב" → "אפ"
    expect(screen.getByText('אפ')).toBeInTheDocument();
  });

  it('shows the edit button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'עריכת פרטים' })).toBeInTheDocument();
  });
});

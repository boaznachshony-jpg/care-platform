import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { emptyMvpProfile, readMvpProfile, saveMvpProfile } from '../storage/mvp-storage.js';
import { employmentSetupCompletedCount, OnboardingPage } from './OnboardingPage.js';

function renderPage() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

function openEmployerStep() {
  fireEvent.change(screen.getByLabelText(/שם המטופל/), {
    target: { value: 'אילנה כהן' },
  });
  fireEvent.click(screen.getByRole('button', { name: /המשך/ }));
  fireEvent.click(screen.getByLabelText(/המעסיק הוא אדם אחר/));
}

describe('ATM onboarding validation and persistence', () => {
  beforeEach(() => localStorage.clear());

  it('shows a specific checksum error and prevents continuing', () => {
    renderPage();
    openEmployerStep();

    fireEvent.change(screen.getByLabelText(/שם המעסיק/), {
      target: { value: 'בועז לוי' },
    });
    fireEvent.change(screen.getByLabelText(/מספר תעודת זהות/), {
      target: { value: '123456789' },
    });
    fireEvent.change(screen.getByLabelText(/מספר טלפון/), {
      target: { value: '052-123-4567' },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/ספרת ביקורת/);
    expect(screen.getByRole('button', { name: /המשך/ })).toBeDisabled();
  });

  it('strips pasted separators while keeping a leading zero and shows the digit count', () => {
    renderPage();
    openEmployerStep();
    const idField = screen.getByLabelText(/מספר תעודת זהות/);

    fireEvent.change(idField, { target: { value: '000-000 018' } });

    expect(idField).toHaveValue('000000018');
    expect(screen.getByText(/9 מתוך 9 ספרות/)).toBeInTheDocument();
    expect(screen.queryByText(/ספרת ביקורת/)).not.toBeInTheDocument();
  });

  it('normalizes a full formatted Israeli ID before applying the nine-digit limit', () => {
    renderPage();
    openEmployerStep();
    const idField = screen.getByLabelText(/מספר תעודת זהות/);

    fireEvent.change(idField, { target: { value: '038-852 562' } });

    expect(idField).toHaveValue('038852562');
    expect(screen.queryByText(/ספרת ביקורת/)).not.toBeInTheDocument();
  });

  it('saves partial details and resumes at the last completed step after reopening', () => {
    const firstRender = renderPage();
    fireEvent.change(screen.getByLabelText(/שם המטופל/), {
      target: { value: 'שרה לוי' },
    });
    fireEvent.click(screen.getByRole('button', { name: /המשך/ }));
    firstRender.unmount();

    renderPage();

    expect(screen.getByText(/מי רשום כמעסיק/)).toBeInTheDocument();
    expect(readMvpProfile().recipientName).toBe('שרה לוי');
  });

  it('rejects numeric-only names with an accessible field error', () => {
    renderPage();
    const name = screen.getByLabelText(/שם המטופל/);
    fireEvent.change(name, { target: { value: '123456789' } });
    fireEvent.blur(name);

    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(/שם באותיות/);
  });

  it('marks required selections and the employment date with visible accessible errors', () => {
    saveMvpProfile({
      ...emptyMvpProfile,
      recipientName: 'שרה לוי',
      employerName: 'שרה לוי',
      employerIdNumber: '038852562',
      employerPhone: '052-123-4567',
    });
    localStorage.setItem('caredesk.onboarding.step.default', '2');
    renderPage();

    const country = screen.getByLabelText(/ארץ מוצא/);
    const language = screen.getByLabelText(/שפה מועדפת/);
    const startDate = screen.getByLabelText(/תאריך תחילת ההעסקה/);
    fireEvent.blur(country);
    fireEvent.blur(language);
    fireEvent.blur(startDate);

    expect(country).toHaveClass('field-input-error');
    expect(country).toHaveAttribute('aria-invalid', 'true');
    expect(language).toHaveClass('field-input-error');
    expect(startDate).toHaveClass('field-input-error');
    expect(screen.getAllByRole('alert')).toHaveLength(3);
  });

  it('marks every invalid checklist date and amount with an explanatory error', () => {
    saveMvpProfile({
      ...emptyMvpProfile,
      recipientName: 'שרה לוי',
      employerName: 'שרה לוי',
      employerIdNumber: '038852562',
      employerPhone: '052-123-4567',
      caregiverName: 'Maria Santos',
      caregiverCountry: 'Philippines',
      caregiverLanguage: 'English',
      employmentStartDate: '2026-08-01',
    });
    localStorage.setItem('caredesk.onboarding.step.default', '5');
    renderPage();

    fireEvent.click(screen.getByLabelText(/נרכש ביטוח רפואי/));
    const insuranceDate = screen.getByLabelText(/תוקף הביטוח הרפואי/);
    const baseSalary = screen.getByLabelText(/שכר בסיס חודשי/);
    const saturdayRate = screen.getByLabelText(/מחיר לשבת/);
    const licenseDate = screen.getByLabelText(/מועד חידוש רישיון/);
    const visaDate = screen.getByLabelText(/מועד חידוש הוויזה/);

    fireEvent.blur(insuranceDate);
    fireEvent.change(baseSalary, { target: { value: '-1' } });
    fireEvent.blur(baseSalary);
    fireEvent.change(saturdayRate, { target: { value: '0' } });
    fireEvent.blur(saturdayRate);
    fireEvent.blur(licenseDate);
    fireEvent.blur(visaDate);

    for (const field of [insuranceDate, baseSalary, saturdayRate, licenseDate, visaDate]) {
      expect(field).toHaveClass('field-input-error');
      expect(field).toHaveAttribute('aria-invalid', 'true');
    }
    expect(screen.getAllByRole('alert')).toHaveLength(5);
  });
});

describe('first-run employment checklist', () => {
  it('requires all six operational setup items', () => {
    expect(employmentSetupCompletedCount(emptyMvpProfile)).toBe(0);
    expect(
      employmentSetupCompletedCount({
        ...emptyMvpProfile,
        employmentAgreementConfirmed: true,
        medicalInsuranceConfirmed: true,
        medicalInsuranceExpiryDate: '2027-06-30',
        baseSalary: 6_500,
        saturdayRate: 440,
        licenseRenewalDate: '2027-07-12',
        visaRenewalDate: '2026-08-15',
      }),
    ).toBe(6);
  });

  it('does not count medical insurance as complete without a valid expiry date', () => {
    expect(
      employmentSetupCompletedCount({
        ...emptyMvpProfile,
        medicalInsuranceConfirmed: true,
        medicalInsuranceExpiryDate: '2026-02-30',
      }),
    ).toBe(0);
  });
});

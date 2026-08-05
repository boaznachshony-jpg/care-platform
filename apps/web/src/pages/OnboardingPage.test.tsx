import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { emptyMvpProfile } from '../storage/mvp-storage.js';
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

describe('OnboardingPage Israeli ID field', () => {
  beforeEach(() => localStorage.clear());

  it('shows a clear error and prevents continuing for an invalid checksum', () => {
    renderPage();

    fireEvent.change(screen.getByLabelText(/שם המעסיק|שם מלא/), {
      target: { value: 'בועז לוי' },
    });
    fireEvent.change(screen.getByLabelText(/מספר תעודת זהות/), {
      target: { value: '123456789' },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('מספר תעודת הזהות אינו תקין');
    expect(screen.getByRole('button', { name: /המשך/ })).toBeDisabled();
  });

  it('accepts and normalizes a valid formatted ID when leaving the field', () => {
    renderPage();
    const idField = screen.getByLabelText(/מספר תעודת זהות/);

    fireEvent.change(idField, { target: { value: '123-456 782' } });
    fireEvent.blur(idField);

    expect(idField).toHaveValue('123456782');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
        employmentFeeDueDate: '2026-08-15',
      }),
    ).toBe(6);
  });

  it('does not count medical insurance as complete without an expiry date', () => {
    expect(
      employmentSetupCompletedCount({
        ...emptyMvpProfile,
        medicalInsuranceConfirmed: true,
      }),
    ).toBe(0);
  });
});

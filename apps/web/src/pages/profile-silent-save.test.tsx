import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';

/**
 * Silent saves (17.10.2026), place 3: every screen that writes the profile
 * through `useMvpProfile` — settings, the caregiver's details, onboarding and
 * the payroll salary settings.
 *
 * The hook's setter wrote and then put the new profile into state no matter
 * what. A refused write threw out of the screen's handler: settings and the
 * caregiver screen said nothing, and onboarding moved on (or, on its last
 * step, cleared the draft and left the wizard) as if the step had been kept.
 */
const mocks = vi.hoisted(() => ({
  ensureCanonicalCase: vi.fn(),
  recordLegalAcceptance: vi.fn(),
  getBillingSubscription: vi.fn(),
}));

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return {
    ...actual,
    recordLegalAcceptance: mocks.recordLegalAcceptance,
    getBillingSubscription: mocks.getBillingSubscription,
    listCanonicalPayrollCloses: () => Promise.resolve([]),
  };
});
vi.mock('../canonical-case.js', async () => {
  const actual =
    await vi.importActual<typeof import('../canonical-case.js')>('../canonical-case.js');
  return { ...actual, ensureCanonicalCase: mocks.ensureCanonicalCase };
});

import {
  emptyMvpProfile,
  readMvpProfile,
  saveMvpProfile,
  type MvpProfile,
} from '../storage/mvp-storage.js';
import { EmployeePage } from './EmployeePage.js';
import { OnboardingPage } from './OnboardingPage.js';
import { PayrollPage } from './PayrollPage.js';
import { SettingsPage } from './SettingsPage.js';

const originalSetItem = Storage.prototype.setItem;

/** From now on the device refuses writes to keys starting with this prefix. */
function refuseWrites(keyPrefix: string) {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key.startsWith(keyPrefix)) throw new DOMException('refused', 'QuotaExceededError');
    originalSetItem.call(this, key, value);
  });
}

const REFUSED = /השמירה נכשלה והשינוי לא נשמר: אין מספיק מקום פנוי/;

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function renderAt(path: string, routePattern: string, element: React.ReactElement) {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route path={routePattern} element={element} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const settingsProfile: MvpProfile = {
  ...emptyMvpProfile,
  recipientName: 'אילנה כהן',
  employerName: 'בועז לוי',
  employerIdNumber: '038852562',
  employerPhone: '050-0000000',
  caregiverName: 'אנה פטרוב',
  // Both are `required` on the caregiver form; empty, it would never submit.
  caregiverCountry: 'אוקראינה',
  caregiverLanguage: 'רוסית',
};

beforeEach(() => {
  localStorage.clear();
  mocks.ensureCanonicalCase.mockReset().mockResolvedValue(undefined);
  mocks.recordLegalAcceptance.mockReset().mockResolvedValue({ acceptances: [] });
  mocks.getBillingSubscription
    .mockReset()
    .mockResolvedValue({ status: 'payment_method_pending', paymentMethod: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SettingsPage', () => {
  beforeEach(() => {
    history.replaceState({}, '', '/clients/client-1/settings');
    saveMvpProfile(settingsProfile);
  });

  function submitCityChange() {
    fireEvent.change(screen.getAllByLabelText('עיר או יישוב')[0]!, {
      target: { value: 'חיפה' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת השינויים' }));
  }

  it('shows a refused save and never says it was saved', () => {
    renderAt('/clients/client-1/settings', '/clients/:clientId/settings', <SettingsPage />);
    refuseWrites('caredesk.mvp.profile.');

    submitCityChange();

    expect(screen.getByRole('alert')).toHaveTextContent(REFUSED);
    expect(screen.queryByText('השינויים נשמרו בהצלחה')).not.toBeInTheDocument();
    expect(readMvpProfile().recipientCity).toBe('');
    // What was typed is still in the form, ready for the same press again.
    expect(screen.getAllByLabelText('עיר או יישוב')[0]).toHaveValue('חיפה');
  });

  it('says the profile was kept when only the employer list label is refused', () => {
    renderAt('/clients/client-1/settings', '/clients/:clientId/settings', <SettingsPage />);
    refuseWrites('caredesk.mvp.clients.');

    submitCityChange();

    expect(screen.getByRole('alert')).toHaveTextContent(
      /פרטי הפרופיל נשמרו, אבל עדכון נלווה לא נשמר/,
    );
    expect(screen.getByText('השינויים נשמרו בהצלחה')).toBeInTheDocument();
    expect(readMvpProfile().recipientCity).toBe('חיפה');
  });
});

describe('EmployeePage', () => {
  it('keeps the edit form open with what was typed when the save is refused', () => {
    history.replaceState({}, '', '/clients/client-1/employee');
    saveMvpProfile(settingsProfile);
    renderAt('/clients/client-1/employee', '/clients/:clientId/employee', <EmployeePage />);
    refuseWrites('caredesk.mvp.profile.');

    fireEvent.click(screen.getByRole('button', { name: 'עריכת פרטים' }));
    fireEvent.change(screen.getByLabelText('שם המטפל או המטפלת'), {
      target: { value: 'מריה סנטוס' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת הפרטים' }));

    expect(screen.getByRole('alert')).toHaveTextContent(REFUSED);
    expect(screen.queryByText('פרטי המטפל נשמרו.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('שם המטפל או המטפלת')).toHaveValue('מריה סנטוס');
    expect(readMvpProfile().caregiverName).toBe('אנה פטרוב');
  });
});

describe('OnboardingPage', () => {
  beforeEach(() => {
    history.replaceState({}, '', '/onboarding');
  });

  it('stays on the step whose details were refused', () => {
    renderAt('/onboarding', '/onboarding', <OnboardingPage />);
    fireEvent.change(screen.getByLabelText(/שם המטופל/), { target: { value: 'אילנה כהן' } });
    refuseWrites('caredesk.mvp.profile.');

    fireEvent.click(screen.getByRole('button', { name: /המשך/ }));

    expect(screen.getByRole('alert')).toHaveTextContent(REFUSED);
    expect(screen.getByLabelText(/שם המטופל/)).toHaveValue('אילנה כהן');
    expect(readMvpProfile().recipientName).toBe('');
  });

  it('says so when the in-progress draft is refused', () => {
    renderAt('/onboarding', '/onboarding', <OnboardingPage />);
    fireEvent.change(screen.getByLabelText(/שם המטופל/), { target: { value: 'אילנה כהן' } });
    fireEvent.click(screen.getByRole('button', { name: /המשך/ }));
    refuseWrites('caredesk.mvp.onboarding-draft.');

    fireEvent.click(screen.getByLabelText(/המעסיק הוא אדם אחר/));

    expect(screen.getByRole('alert')).toHaveTextContent(REFUSED);
  });

  it('does not finish setup when the final profile is refused', async () => {
    saveMvpProfile({
      ...emptyMvpProfile,
      recipientName: 'אילנה כהן',
      employmentAgreementConfirmed: true,
      medicalInsuranceConfirmed: true,
      medicalInsuranceExpiryDate: '2027-06-30',
      baseSalary: 6_500,
      saturdayRate: 440,
      licenseRenewalDate: '2027-07-12',
      visaRenewalDate: '2026-08-15',
    });
    localStorage.setItem('caredesk.onboarding.step.default', '5');
    renderAt('/onboarding', '/onboarding', <OnboardingPage />);
    refuseWrites('caredesk.mvp.profile.');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /שמירת הרשימה והמשך לאמצעי תשלום/ }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent(REFUSED);
    expect(screen.getByTestId('location')).toHaveTextContent('/onboarding');
    expect(mocks.ensureCanonicalCase).not.toHaveBeenCalled();
    expect(readMvpProfile().onboardingCompleted).toBe(false);
  });
});

describe('PayrollPage salary settings', () => {
  it('stays on the salary step when the profile is refused', () => {
    history.replaceState({}, '', '/payroll');
    renderAt('/payroll', '/payroll', <PayrollPage />);
    fireEvent.change(screen.getByLabelText('שכר בסיס חודשי בש״ח'), { target: { value: '6500' } });
    fireEvent.change(screen.getByLabelText('בתוקף מתאריך'), { target: { value: '2026-01-01' } });
    refuseWrites('caredesk.mvp.profile.');

    fireEvent.click(screen.getByRole('button', { name: 'שמירת הגדרת השכר' }));

    expect(screen.getByRole('alert')).toHaveTextContent(REFUSED);
    expect(screen.queryByText(/הגדרת השכר נשמרה/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'שמירת הגדרת השכר' })).toBeInTheDocument();
  });
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n, PRIVACY_DOCUMENT_VERSION, TERMS_DOCUMENT_VERSION } from '@caredesk/i18n';

const mocks = vi.hoisted(() => ({
  recordLegalAcceptance: vi.fn(),
  ensureCanonicalCase: vi.fn(),
  getBillingSubscription: vi.fn(),
}));

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return {
    ...actual,
    recordLegalAcceptance: mocks.recordLegalAcceptance,
    getBillingSubscription: mocks.getBillingSubscription,
  };
});

vi.mock('../canonical-case.js', async () => {
  const actual =
    await vi.importActual<typeof import('../canonical-case.js')>('../canonical-case.js');
  return { ...actual, ensureCanonicalCase: mocks.ensureCanonicalCase };
});

import { ApiRequestError } from '../api/client.js';
import {
  emptyMvpProfile,
  readMvpOnboardingDraft,
  readMvpProfile,
  saveMvpProfile,
} from '../storage/mvp-storage.js';
import { employmentSetupCompletedCount, OnboardingPage } from './OnboardingPage.js';

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname + location.search}</span>;
}

function renderPage() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <MemoryRouter>
        <LocationProbe />
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

  it('auto-saves in-progress input as a draft and restores it after leaving mid-step', () => {
    vi.useFakeTimers();
    try {
      const firstRender = renderPage();
      fireEvent.change(screen.getByLabelText(/שם המטופל/), {
        target: { value: '123' },
      });
      act(() => vi.advanceTimersByTime(600));
      firstRender.unmount();

      renderPage();

      // The invalid in-progress value is restored as a draft...
      expect(screen.getByLabelText(/שם המטופל/)).toHaveValue('123');
      // ...but it never reaches the committed profile and still blocks המשך.
      expect(readMvpProfile().recipientName).toBe('');
      expect(screen.getByRole('button', { name: /המשך/ })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('debounces draft persistence while typing', () => {
    vi.useFakeTimers();
    try {
      renderPage();
      const name = screen.getByLabelText(/שם המטופל/);
      fireEvent.change(name, { target: { value: 'שר' } });
      act(() => vi.advanceTimersByTime(300));
      expect(readMvpOnboardingDraft()).toBeNull();

      fireEvent.change(name, { target: { value: 'שרה' } });
      act(() => vi.advanceTimersByTime(300));
      expect(readMvpOnboardingDraft()).toBeNull();

      act(() => vi.advanceTimersByTime(300));
      expect(readMvpOnboardingDraft()?.profile.recipientName).toBe('שרה');
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers locality suggestions for the recipient city while allowing free text', () => {
    renderPage();
    const city = screen.getByLabelText(/עיר או יישוב/);

    fireEvent.change(city, { target: { value: 'חיפ' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: 'חיפה' }));
    expect(city).toHaveValue('חיפה');

    fireEvent.change(city, { target: { value: 'יישוב שאינו ברשימה' } });
    expect(city).toHaveValue('יישוב שאינו ברשימה');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
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

/**
 * Finishing setup is the moment the caregiver's identity documents, visa data
 * and payroll details start being held - and that happens whether or not the
 * user ever reaches the billing screen. Recording consent only at payment would
 * leave the account that matters most for privacy purposes, the one holding a
 * third party's data with no subscription, with no record of anything.
 *
 * Both tests fail against the code before this change: `/terms` and `/privacy`
 * were never shown here and nothing was recorded.
 */
describe('onboarding legal acceptance', () => {
  const completedChecklist = {
    ...emptyMvpProfile,
    recipientName: 'אילנה כהן',
    employmentAgreementConfirmed: true,
    medicalInsuranceConfirmed: true,
    medicalInsuranceExpiryDate: '2027-06-30',
    baseSalary: 6_500,
    saturdayRate: 440,
    licenseRenewalDate: '2027-07-12',
    visaRenewalDate: '2026-08-15',
  };

  beforeEach(() => {
    localStorage.clear();
    mocks.recordLegalAcceptance.mockReset().mockResolvedValue({ acceptances: [] });
    mocks.ensureCanonicalCase.mockReset().mockResolvedValue(undefined);
    // Default: an account that has never engaged billing at all — the
    // untouched status a fresh subscription row gets from getOrCreate.
    mocks.getBillingSubscription
      .mockReset()
      .mockResolvedValue({ status: 'payment_method_pending', paymentMethod: null });
    saveMvpProfile(completedChecklist);
    // Restore straight onto the final step rather than typing through six of
    // them; the step index is persisted exactly this way by the wizard itself.
    localStorage.setItem('caredesk.onboarding.step.default', '5');
  });

  async function clickComplete() {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /שמירת הרשימה והמשך לאמצעי תשלום/ }));
    });
  }

  it('shows the terms and privacy links beside the button that completes setup', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'תקנון השימוש' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'מדיניות הפרטיות' })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });

  it('records acceptance of both documents when setup is completed', async () => {
    renderPage();
    await clickComplete();

    expect(mocks.recordLegalAcceptance).toHaveBeenCalledWith({
      context: 'onboarding',
      documents: [
        { document: 'terms', version: TERMS_DOCUMENT_VERSION },
        { document: 'privacy', version: PRIVACY_DOCUMENT_VERSION },
      ],
    });
  });

  it('still completes setup when the acceptance cannot be sent', async () => {
    // Setup must finish offline. The recording is idempotent per
    // (user, document, version), so the billing flow - where it is awaited and
    // blocking - re-records it for free if this call was lost.
    mocks.recordLegalAcceptance.mockRejectedValue(new Error('offline'));
    renderPage();
    await clickComplete();

    expect(readMvpProfile().onboardingCompleted).toBe(true);
  });

  /**
   * Defect: `.catch(() => undefined)` treated the billing flow's re-record as
   * a guarantee, but that only holds for a customer who actually reaches
   * /billing. A customer who closes the tab right here left an account
   * holding a caregiver's identity documents, visa data and payroll figures
   * with no record anyone accepted anything, and nothing ever retried it.
   */
  describe('a failed acceptance leaves a trace instead of being discarded', () => {
    const PENDING_KEY = 'caredesk.onboarding.pending-legal-acceptance.v1';
    const expectedAcceptance = {
      context: 'onboarding',
      documents: [
        { document: 'terms', version: TERMS_DOCUMENT_VERSION },
        { document: 'privacy', version: PRIVACY_DOCUMENT_VERSION },
      ],
    };

    it('queues the acceptance locally when recording fails for a reason other than a rejected request', async () => {
      mocks.recordLegalAcceptance.mockRejectedValue(new Error('network down'));
      renderPage();
      await clickComplete();

      expect(JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null')).toEqual(expectedAcceptance);
    });

    it('does not queue a retry for a request the server rejected as malformed', async () => {
      mocks.recordLegalAcceptance.mockRejectedValue(new ApiRequestError(422, 'VALIDATION_ERROR'));
      renderPage();
      await clickComplete();

      // Retrying an identical 4xx forever would never succeed - it would
      // just keep firing the same doomed request on every later visit.
      expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    });

    it('retries a queued acceptance on the next mount and clears it once it succeeds', async () => {
      localStorage.setItem(PENDING_KEY, JSON.stringify(expectedAcceptance));
      mocks.recordLegalAcceptance.mockResolvedValue({ acceptances: [] });

      renderPage();

      await waitFor(() =>
        expect(mocks.recordLegalAcceptance).toHaveBeenCalledWith(expectedAcceptance),
      );
      await waitFor(() => expect(localStorage.getItem(PENDING_KEY)).toBeNull());
    });

    it('leaves the queued acceptance in place when the retry itself fails', async () => {
      localStorage.setItem(PENDING_KEY, JSON.stringify(expectedAcceptance));
      mocks.recordLegalAcceptance.mockRejectedValue(new Error('still offline'));

      renderPage();

      await waitFor(() =>
        expect(mocks.recordLegalAcceptance).toHaveBeenCalledWith(expectedAcceptance),
      );
      expect(JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null')).toEqual(expectedAcceptance);
    });
  });

  /**
   * Defect: `isFirstRun` was `!profile.onboardingCompleted`, and
   * `useMvpProfile` is scoped to the client id in the URL — so adding a
   * SECOND client to an account that already pays read as "first run" again
   * and sent a paying customer back to /billing instead of to the case they
   * just finished creating.
   */
  describe('navigation after setup depends on the account, not the client record', () => {
    it('sends a first-time account to billing when the subscription has never been engaged', async () => {
      mocks.getBillingSubscription.mockResolvedValue({
        status: 'payment_method_pending',
        paymentMethod: null,
      });
      renderPage();
      await clickComplete();

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/billing?from=onboarding'),
      );
    });

    it('does not send an already-paying account back to billing for a second client', async () => {
      mocks.getBillingSubscription.mockResolvedValue({
        status: 'active',
        paymentMethod: { last4: '1234', expiryMonth: 1, expiryYear: 2030 },
      });
      renderPage();
      await clickComplete();

      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/app'));
    });

    it('treats a started-but-not-yet-paying account as already engaged too', async () => {
      // A payment method setup was started (status moved past the untouched
      // default) even though no card is attached yet - still not a genuine
      // first-time signup.
      mocks.getBillingSubscription.mockResolvedValue({
        status: 'payment_method_ready',
        paymentMethod: null,
      });
      renderPage();
      await clickComplete();

      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/app'));
    });

    /**
     * When the subscription check fails, the answer is unknown, and the code
     * now falls back to the local `isFirstRun` signal (`profile.
     * onboardingCompleted`) instead of always assuming "not first run".
     * Always answering "not first run" meant a genuine new signup who
     * happened to be offline at that moment never saw the billing screen and
     * therefore never paid - a Playwright end-to-end run caught exactly that.
     * The two cases below pin the corrected fallback in both directions.
     */
    it('falls back to billing when the check fails and the local record says this is a first run', async () => {
      // beforeEach's saveMvpProfile(completedChecklist) does not set
      // onboardingCompleted, so it keeps emptyMvpProfile's default of
      // false - i.e. the local record says setup was never finished before.
      mocks.getBillingSubscription.mockRejectedValue(new Error('offline'));
      renderPage();
      await clickComplete();

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/billing?from=onboarding'),
      );
    });

    it('falls back to /app when the check fails and the local record says setup was already completed', async () => {
      saveMvpProfile({ ...completedChecklist, onboardingCompleted: true });
      mocks.getBillingSubscription.mockRejectedValue(new Error('offline'));
      renderPage();
      await clickComplete();

      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/app'));
    });
  });
});

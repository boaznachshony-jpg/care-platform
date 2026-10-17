import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n, PRIVACY_DOCUMENT_VERSION, TERMS_DOCUMENT_VERSION } from '@caredesk/i18n';
import type { BillingPlanResponse } from '@caredesk/schemas';

const mocks = vi.hoisted(() => ({
  getBillingSubscription: vi.fn(),
  startBillingPaymentMethodSetup: vi.fn(),
  cancelBillingSubscription: vi.fn(),
  recordLegalAcceptance: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return { ...actual, ...mocks };
});

vi.mock('../auth/auth-context.js', () => ({
  useAuth: () => ({ user: { email: 'owner@example.test' }, signOut: mocks.signOut }),
}));

import { ApiRequestError } from '../api/client.js';
import { emptyMvpProfile, saveMvpProfile } from '../storage/mvp-storage.js';
import { BillingPage } from './BillingPage.js';

const sponsoredPlan: BillingPlanResponse = {
  status: 'sponsored',
  currency: 'ILS',
  interval: 'month',
  priceAgorot: 3900,
  netAgorot: 3305,
  vatAgorot: 595,
  vatRatePercent: 18,
  includesVat: true,
  launchDiscountPercent: 100,
  effectivePriceAgorot: 0,
  chargingStartsAt: null,
  nextChargeOn: null,
  billingName: null,
  billingEmail: null,
  paymentMethod: null,
  canManage: true,
  providerConfigured: false,
  termsVersion: '2026-08-04',
  accessState: 'active',
  graceDaysRemaining: null,
  graceDays: 7,
  accessGraceStartsAt: null,
};

async function renderPage(initialPath = '/billing') {
  const i18n = initI18n();
  await i18n.changeLanguage('en');
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[initialPath]}>
        <BillingPage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const savedCardPlan: BillingPlanResponse = {
  status: 'sponsored',
  currency: 'ILS',
  interval: 'month',
  priceAgorot: 3900,
  netAgorot: 3305,
  vatAgorot: 595,
  vatRatePercent: 18,
  includesVat: true,
  launchDiscountPercent: 100,
  effectivePriceAgorot: 0,
  chargingStartsAt: null,
  nextChargeOn: null,
  billingName: 'Test Owner',
  billingEmail: 'owner@example.test',
  paymentMethod: { last4: '4242', expiryMonth: 9, expiryYear: 2031 },
  canManage: true,
  providerConfigured: true,
  termsVersion: '2026-08-04',
  accessState: 'active',
  graceDaysRemaining: null,
  graceDays: 7,
  accessGraceStartsAt: null,
};

describe('BillingPage', () => {
  beforeEach(() => {
    mocks.getBillingSubscription.mockReset().mockResolvedValue(sponsoredPlan);
    mocks.startBillingPaymentMethodSetup.mockReset();
    mocks.cancelBillingSubscription.mockReset();
    mocks.recordLegalAcceptance.mockReset().mockResolvedValue({ acceptances: [] });
  });

  it('shows the VAT-inclusive 39 ILS price and the current 100% sponsored charge', async () => {
    await renderPage();
    expect(await screen.findByText('Launch price')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText(/No charge during the pilot/i)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /subscription and recurring billing terms/i }),
    ).toHaveAttribute('href', '/terms/subscription');
  });

  it('keeps card collection disabled until the production provider is configured', async () => {
    await renderPage();
    expect(
      await screen.findByText(/merchant verification is still being completed/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /securely connect a card/i })).toBeDisabled();
  });

  it('shows the actual next charge instead of the pilot promise after paid activation', async () => {
    mocks.getBillingSubscription.mockResolvedValue({
      ...sponsoredPlan,
      status: 'active',
      launchDiscountPercent: 0,
      effectivePriceAgorot: 3900,
      chargingStartsAt: '2026-09-01',
      nextChargeOn: '2026-10-01',
      providerConfigured: true,
    });
    await renderPage();
    expect(await screen.findByText('Monthly subscription active')).toBeInTheDocument();
    expect(screen.getByText(/October 1, 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/No charge during the pilot/i)).not.toBeInTheDocument();
  });

  // ── Past due: a failed charge must never present as an active subscription ─

  const pastDuePlan: BillingPlanResponse = {
    ...savedCardPlan,
    status: 'past_due',
    launchDiscountPercent: 0,
    effectivePriceAgorot: 3900,
    chargingStartsAt: '2026-07-01',
    nextChargeOn: '2026-08-01',
    accessState: 'active',
  };

  it('replaces the "subscription active" note with a failure warning when past_due', async () => {
    mocks.getBillingSubscription.mockResolvedValue(pastDuePlan);
    await renderPage();

    expect(await screen.findByText('The last charge failed')).toBeInTheDocument();
    expect(
      screen.getByText(/please update the payment method to keep the subscription active/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('Monthly subscription active')).not.toBeInTheDocument();
    // The stale "next charge" date of the failed period must not be promised.
    expect(screen.queryByText(/August 1, 2026/)).not.toBeInTheDocument();
  });

  it('reconnects the card through the existing hosted setup flow from the past_due warning', async () => {
    mocks.getBillingSubscription.mockResolvedValue(pastDuePlan);
    mocks.startBillingPaymentMethodSetup.mockResolvedValue({
      checkoutUrl: 'https://secure.cardcom.solutions/hosted/reconnect',
    });
    const assignMock = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign: assignMock });
    await renderPage();

    const reconnect = await screen.findByRole('button', { name: /update payment method/i });
    await act(async () => {
      fireEvent.click(reconnect);
    });

    expect(mocks.startBillingPaymentMethodSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        billingName: 'Test Owner',
        billingEmail: 'owner@example.test',
        acceptsRecurringCharge: true,
      }),
    );
    expect(assignMock).toHaveBeenCalledWith('https://secure.cardcom.solutions/hosted/reconnect');
    vi.unstubAllGlobals();
  });

  it('hides the reconnect button from viewers who cannot manage billing', async () => {
    mocks.getBillingSubscription.mockResolvedValue({ ...pastDuePlan, canManage: false });
    await renderPage();

    expect(await screen.findByText('The last charge failed')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /update payment method/i }),
    ).not.toBeInTheDocument();
  });

  // ── Saved card ────────────────────────────────────────────────────────────

  it('displays the saved card last-four digits and expiry when a payment method exists', async () => {
    mocks.getBillingSubscription.mockResolvedValue(savedCardPlan);
    await renderPage();
    expect(await screen.findByText(/ending in 4242/i)).toBeInTheDocument();
    expect(screen.getByText(/09\/2031/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove payment method/i })).toBeInTheDocument();
    // Setup form must not appear when a card is already saved
    expect(
      screen.queryByRole('button', { name: /securely connect a card/i }),
    ).not.toBeInTheDocument();
  });

  // ── Cardcom redirect return ───────────────────────────────────────────────

  it('shows a success notice when returning from Cardcom after a successful card setup', async () => {
    mocks.getBillingSubscription.mockResolvedValue(savedCardPlan);
    await renderPage('/billing?setup=success');
    expect(await screen.findByText(/submitted for secure verification/i)).toBeInTheDocument();
  });

  it('shows an error notice when returning from Cardcom after a cancelled setup', async () => {
    await renderPage('/billing?setup=failed');
    expect(await screen.findByText(/setup was not completed/i)).toBeInTheDocument();
  });

  // ── Cancel subscription ───────────────────────────────────────────────────

  it('calls cancelBillingSubscription and reloads the plan after owner confirms cancellation', async () => {
    mocks.getBillingSubscription.mockResolvedValue(savedCardPlan);
    mocks.cancelBillingSubscription.mockResolvedValue(undefined);
    // After cancel, return a plan with no payment method
    mocks.getBillingSubscription
      .mockResolvedValueOnce(savedCardPlan)
      .mockResolvedValue({ ...savedCardPlan, status: 'cancelled', paymentMethod: null });

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await renderPage();
    const cancelBtn = await screen.findByRole('button', { name: /remove payment method/i });
    await act(async () => {
      fireEvent.click(cancelBtn);
    });
    expect(mocks.cancelBillingSubscription).toHaveBeenCalledTimes(1);
    // Card should be gone after reload
    expect(
      await screen.findByRole('button', { name: /securely connect a card/i }),
    ).toBeInTheDocument();
  });

  it('warns in the confirm dialog that access ends, and when', async () => {
    // Cancelling removes the card, and a missing card is what freezes the
    // account. Saying only "stop future charges" made the lockout a surprise.
    mocks.getBillingSubscription.mockResolvedValue({ ...savedCardPlan, graceDays: 7 });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderPage();
    const cancelBtn = await screen.findByRole('button', { name: /remove payment method/i });
    fireEvent.click(cancelBtn);

    const message = confirm.mock.calls[0]?.[0] ?? '';
    expect(message).toMatch(/access to CareDesk will be blocked/i);
    expect(message).toContain('7 days');
    // It must also say the data survives, so the warning does not read as
    // "cancelling deletes everything".
    expect(message).toMatch(/data is kept/i);
  });

  it('does not call cancelBillingSubscription when the owner dismisses the confirm dialog', async () => {
    mocks.getBillingSubscription.mockResolvedValue(savedCardPlan);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderPage();
    const cancelBtn = await screen.findByRole('button', { name: /remove payment method/i });
    fireEvent.click(cancelBtn);
    expect(mocks.cancelBillingSubscription).not.toHaveBeenCalled();
  });

  // ── Form submit redirect ──────────────────────────────────────────────────

  it('redirects to the Cardcom hosted page when the setup form is submitted', async () => {
    mocks.getBillingSubscription.mockResolvedValue({ ...sponsoredPlan, providerConfigured: true });
    mocks.startBillingPaymentMethodSetup.mockResolvedValue({
      checkoutUrl: 'https://secure.cardcom.solutions/hosted/setup',
    });
    const assignMock = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign: assignMock });
    await renderPage();

    const nameInput = await screen.findByLabelText(/invoice name/i);
    fireEvent.change(nameInput, { target: { value: 'Test Customer' } });
    fireEvent.click(screen.getByLabelText(/subscription and recurring billing terms/i));
    await act(async () => {
      fireEvent.submit(
        screen.getByRole('button', { name: /securely connect a card/i }).closest('form')!,
      );
    });

    expect(mocks.startBillingPaymentMethodSetup).toHaveBeenCalledWith(
      expect.objectContaining({ billingName: 'Test Customer', acceptsRecurringCharge: true }),
    );
    expect(assignMock).toHaveBeenCalledWith('https://secure.cardcom.solutions/hosted/setup');
    vi.unstubAllGlobals();
  });

  // ── Recorded acceptance ───────────────────────────────────────────────────
  //
  // The defect: `accepted` was a `useState` boolean and nothing else. The box
  // was ticked, the subscription was created, and no trace of the acceptance
  // survived the page. These four tests fail without the change.

  async function submitSetupForm() {
    fireEvent.change(await screen.findByLabelText(/invoice name/i), {
      target: { value: 'Test Customer' },
    });
    fireEvent.click(screen.getByLabelText(/subscription and recurring billing terms/i));
    await act(async () => {
      fireEvent.submit(
        screen.getByRole('button', { name: /securely connect a card/i }).closest('form')!,
      );
    });
  }

  it('records acceptance of the terms and the privacy policy at the displayed versions', async () => {
    mocks.getBillingSubscription.mockResolvedValue({ ...sponsoredPlan, providerConfigured: true });
    mocks.startBillingPaymentMethodSetup.mockResolvedValue({ checkoutUrl: 'https://x.test/setup' });
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    await renderPage();

    await submitSetupForm();

    expect(mocks.recordLegalAcceptance).toHaveBeenCalledWith({
      context: 'billing',
      documents: [
        { document: 'terms', version: TERMS_DOCUMENT_VERSION },
        { document: 'privacy', version: PRIVACY_DOCUMENT_VERSION },
      ],
    });
    vi.unstubAllGlobals();
  });

  it('records the acceptance before the subscription is created, not after', async () => {
    // Ordering, not merely occurrence. The user is redirected to the hosted
    // payment page on the next line and never returns to this component, so an
    // acceptance written "afterwards" has nowhere to run.
    const order: string[] = [];
    mocks.getBillingSubscription.mockResolvedValue({ ...sponsoredPlan, providerConfigured: true });
    mocks.recordLegalAcceptance.mockImplementation(async () => {
      order.push('acceptance');
      return { acceptances: [] };
    });
    mocks.startBillingPaymentMethodSetup.mockImplementation(async () => {
      order.push('subscription');
      return { checkoutUrl: 'https://x.test/setup' };
    });
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    await renderPage();

    await submitSetupForm();

    expect(order).toEqual(['acceptance', 'subscription']);
    vi.unstubAllGlobals();
  });

  it('does not create a subscription when the acceptance cannot be recorded', async () => {
    mocks.getBillingSubscription.mockResolvedValue({ ...sponsoredPlan, providerConfigured: true });
    mocks.recordLegalAcceptance.mockRejectedValue(new Error('network error'));
    const assignMock = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign: assignMock });
    await renderPage();

    await submitSetupForm();

    // A live paid subscription with no record that its terms were accepted is
    // precisely the state this change exists to make impossible.
    expect(mocks.startBillingPaymentMethodSetup).not.toHaveBeenCalled();
    expect(assignMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/could not record your acceptance/i)).toBeInTheDocument();
    // The button must come back, not stay stuck in its busy state.
    expect(screen.getByRole('button', { name: /securely connect a card/i })).toBeEnabled();
    vi.unstubAllGlobals();
  });

  /**
   * Reported from production: the customer ticked the consent box, pressed the
   * button, and read "we could not record your acceptance… please try again".
   * Every retry produced the same sentence.
   *
   * The sentence was not true and the instruction could not work. Both failure
   * paths were `catch {}` — the error was discarded unread — so an expired
   * session reached the screen wearing the words of a consent failure, and
   * left nothing in the console to tell the two apart. Hours went into looking
   * for a defect in the acceptance code, which was working correctly the whole
   * time.
   */
  describe('a failure says which failure it was', () => {
    it('reports an expired session as an expired session, not as a consent failure', async () => {
      mocks.getBillingSubscription.mockResolvedValue({
        ...sponsoredPlan,
        providerConfigured: true,
      });
      mocks.recordLegalAcceptance.mockRejectedValue(new ApiRequestError(401, 'UNAUTHENTICATED'));
      const assignMock = vi.fn();
      vi.stubGlobal('location', { ...window.location, assign: assignMock });
      await renderPage();

      await submitSetupForm();

      expect(await screen.findByText(/your session has expired/i)).toBeInTheDocument();
      // The old sentence blamed the acceptance and told the customer to retry.
      // A retry carries the same dead token, so it can never succeed.
      expect(screen.queryByText(/could not record your acceptance/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument();
      // Nothing was started, and the customer must not be told otherwise.
      expect(mocks.startBillingPaymentMethodSetup).not.toHaveBeenCalled();
      expect(assignMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('carries the cause of a genuine consent failure instead of discarding it', async () => {
      mocks.getBillingSubscription.mockResolvedValue({
        ...sponsoredPlan,
        providerConfigured: true,
      });
      mocks.recordLegalAcceptance.mockRejectedValue(new ApiRequestError(500, 'INTERNAL'));
      vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
      await renderPage();

      await submitSetupForm();

      expect(await screen.findByText(/could not record your acceptance/i)).toBeInTheDocument();
      // The status and code the API already returned, so a customer can quote
      // it and a maintainer can act on it.
      expect(screen.getByText('(500/INTERNAL)')).toBeInTheDocument();
      vi.unstubAllGlobals();
    });

    it('reports an expired session from the payment-provider call too', async () => {
      mocks.getBillingSubscription.mockResolvedValue({
        ...sponsoredPlan,
        providerConfigured: true,
      });
      mocks.startBillingPaymentMethodSetup.mockRejectedValue(
        new ApiRequestError(401, 'UNAUTHENTICATED'),
      );
      vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
      await renderPage();

      await submitSetupForm();

      expect(await screen.findByText(/your session has expired/i)).toBeInTheDocument();
      vi.unstubAllGlobals();
    });
  });

  it('does not record an acceptance from the past-due reconnect flow', async () => {
    // That screen shows no consent checkbox and no document. Writing a row from
    // it would record an acceptance the customer never gave.
    mocks.getBillingSubscription.mockResolvedValue(pastDuePlan);
    mocks.startBillingPaymentMethodSetup.mockResolvedValue({
      checkoutUrl: 'https://x.test/reconnect',
    });
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    await renderPage();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /update payment method/i }));
    });

    expect(mocks.startBillingPaymentMethodSetup).toHaveBeenCalled();
    expect(mocks.recordLegalAcceptance).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('links the consent sentence to all three documents', async () => {
    mocks.getBillingSubscription.mockResolvedValue({ ...sponsoredPlan, providerConfigured: true });
    await renderPage();

    expect(await screen.findByRole('link', { name: /^the terms of service$/i })).toHaveAttribute(
      'href',
      '/terms',
    );
    expect(screen.getByRole('link', { name: /^the privacy policy$/i })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(
      screen.getByRole('link', { name: /subscription and recurring billing terms/i }),
    ).toHaveAttribute('href', '/terms/subscription');
  });

  // ── Every product_subscription.status gets its own honest branch ──────────
  //
  // Before this, only 'past_due' had a dedicated note; everything else fell
  // through to "you will be charged X on Y" — and for 'cancelled' the API
  // has already nulled nextChargeOn, so that fallback read chargingStartsAt,
  // a date that is always in the past for a cancelled subscription.

  it('never shows a past charge date for a cancelled subscription', async () => {
    mocks.getBillingSubscription.mockResolvedValue({
      ...savedCardPlan,
      status: 'cancelled',
      paymentMethod: null,
      chargingStartsAt: '2026-01-01',
      nextChargeOn: null,
      accessGraceStartsAt: '2026-08-21',
    });
    await renderPage();

    // Not the "paid and active" wording, and not the stale historic date.
    expect(screen.queryByText('Monthly subscription active')).not.toBeInTheDocument();
    expect(screen.queryByText(/January 1, 2026/)).not.toBeInTheDocument();
    // The cancelled note itself is inline Hebrew (packages/i18n is owned by
    // another workstream mid-change — see the comment on
    // renderPlanStatusNote in BillingPage.tsx), so it renders regardless of
    // the page's language setting.
    expect(await screen.findByText('המנוי בוטל')).toBeInTheDocument();
  });

  it('tells a tenant with no payment method yet that nothing has been charged', async () => {
    mocks.getBillingSubscription.mockResolvedValue({
      ...savedCardPlan,
      status: 'payment_method_pending',
      paymentMethod: null,
      chargingStartsAt: '2026-09-01',
      nextChargeOn: null,
    });
    await renderPage();

    expect(screen.queryByText('Monthly subscription active')).not.toBeInTheDocument();
    expect(await screen.findByText('טרם הוגדר אמצעי תשלום')).toBeInTheDocument();
  });

  it('renders a neutral note instead of "paid and active" for a status this build does not recognise', async () => {
    mocks.getBillingSubscription.mockResolvedValue({
      ...savedCardPlan,
      // A future status value this deployed build predates — the API layer
      // already accepts whatever the DB constraint allows; the client must
      // never default an unrecognised value to "paid and active".
      status: 'future_status_this_build_does_not_know' as BillingPlanResponse['status'],
    });
    await renderPage();

    expect(screen.queryByText('Monthly subscription active')).not.toBeInTheDocument();
    expect(await screen.findByText('לא ניתן לקבוע את מצב המנוי')).toBeInTheDocument();
  });

  // ── Non-owner view ────────────────────────────────────────────────────────

  it('shows an owner-only message when the actor cannot manage billing', async () => {
    mocks.getBillingSubscription.mockResolvedValue({ ...sponsoredPlan, canManage: false });
    await renderPage();
    expect(
      await screen.findByText(/only the account owner can manage the payment method/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /securely connect a card/i }),
    ).not.toBeInTheDocument();
  });

  // ── Load error ────────────────────────────────────────────────────────────

  it('shows a retry button when the subscription cannot be loaded', async () => {
    mocks.getBillingSubscription.mockRejectedValue(new Error('network error'));
    await renderPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  // ── Payer details copied from the care recipient ─────────────────────────

  describe('same-as-recipient payer default', () => {
    beforeEach(() => {
      localStorage.clear();
      saveMvpProfile({
        ...emptyMvpProfile,
        recipientName: 'Ilana Cohen',
        recipientEmail: 'ilana@example.test',
      });
    });

    it('copies the recipient details once and keeps the payer fields editable', async () => {
      await renderPage();

      const checkbox = await screen.findByLabelText(/same as care recipient details/i);
      fireEvent.click(checkbox);

      const nameInput = screen.getByLabelText(/invoice name/i);
      const emailInput = screen.getByLabelText(/invoice email/i);
      expect(nameInput).toHaveValue('Ilana Cohen');
      expect(emailInput).toHaveValue('ilana@example.test');

      // One-time copy — the payer fields stay editable, no live binding.
      fireEvent.change(nameInput, { target: { value: 'Different Payer' } });
      expect(nameInput).toHaveValue('Different Payer');
      expect(emailInput).toHaveValue('ilana@example.test');
      expect(checkbox).toBeChecked();
    });

    it('keeps the auth email when the recipient has no email to copy', async () => {
      localStorage.clear();
      saveMvpProfile({ ...emptyMvpProfile, recipientName: 'Ilana Cohen' });
      await renderPage();

      fireEvent.click(await screen.findByLabelText(/same as care recipient details/i));

      expect(screen.getByLabelText(/invoice name/i)).toHaveValue('Ilana Cohen');
      expect(screen.getByLabelText(/invoice email/i)).toHaveValue('owner@example.test');
    });

    it('hides the copy option when no recipient details exist', async () => {
      localStorage.clear();
      await renderPage();

      expect(await screen.findByLabelText(/invoice name/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/same as care recipient details/i)).not.toBeInTheDocument();
    });

    /**
     * The regression: `useState(readMvpRecipientContact)` is a lazy initialiser,
     * so it ran once, on the first render. That was correct while the MVP store
     * was local-only. Once the workspace became server-canonical and
     * asynchronously hydrated, the read happened before hydration landed and the
     * component never looked again.
     *
     * On a warm device localStorage was already populated and the one-shot read
     * succeeded, which is why it tested fine. On a cold cache — another device,
     * a cleared cache, or a customer who had just signed up — the payer name
     * defaulted to empty and the copy option vanished entirely, because it only
     * renders when there is a contact to copy.
     */
    it('picks up the care recipient when the workspace arrives after the first render', async () => {
      localStorage.clear();
      await renderPage();

      // Cold cache: nothing to copy from yet.
      expect(await screen.findByLabelText(/invoice name/i)).toHaveValue('');
      expect(screen.queryByLabelText(/same as care recipient details/i)).not.toBeInTheDocument();

      // Hydration lands.
      await act(async () => {
        saveMvpProfile({
          ...emptyMvpProfile,
          recipientName: 'Ilana Cohen',
          recipientEmail: 'ilana@example.test',
        });
      });

      expect(await screen.findByLabelText(/same as care recipient details/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/invoice name/i)).toHaveValue('Ilana Cohen');
    });

    it('does not overwrite a payer name the customer already typed', async () => {
      localStorage.clear();
      await renderPage();

      const nameInput = await screen.findByLabelText(/invoice name/i);
      fireEvent.change(nameInput, { target: { value: 'Different Payer' } });

      await act(async () => {
        saveMvpProfile({ ...emptyMvpProfile, recipientName: 'Ilana Cohen' });
      });

      // Late hydration fills an empty field; it never takes one back.
      expect(nameInput).toHaveValue('Different Payer');
    });
  });
});

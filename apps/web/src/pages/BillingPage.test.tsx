import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import type { BillingPlanResponse } from '@caredesk/schemas';

const mocks = vi.hoisted(() => ({
  getBillingSubscription: vi.fn(),
  startBillingPaymentMethodSetup: vi.fn(),
  cancelBillingSubscription: vi.fn(),
}));

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return { ...actual, ...mocks };
});

vi.mock('../auth/auth-context.js', () => ({
  useAuth: () => ({ user: { email: 'owner@example.test' } }),
}));

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
  });
});

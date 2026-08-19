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

  // ── Saved card ────────────────────────────────────────────────────────────

  it('displays the saved card last-four digits and expiry when a payment method exists', async () => {
    mocks.getBillingSubscription.mockResolvedValue(savedCardPlan);
    await renderPage();
    expect(await screen.findByText(/ending in 4242/i)).toBeInTheDocument();
    expect(screen.getByText(/09\/2031/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove payment method/i })).toBeInTheDocument();
    // Setup form must not appear when a card is already saved
    expect(screen.queryByRole('button', { name: /securely connect a card/i })).not.toBeInTheDocument();
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
    await act(async () => { fireEvent.click(cancelBtn); });
    expect(mocks.cancelBillingSubscription).toHaveBeenCalledTimes(1);
    // Card should be gone after reload
    expect(await screen.findByRole('button', { name: /securely connect a card/i })).toBeInTheDocument();
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
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    await renderPage();

    const nameInput = await screen.findByLabelText(/invoice name/i);
    fireEvent.change(nameInput, { target: { value: 'Test Customer' } });
    fireEvent.click(screen.getByLabelText(/subscription and recurring billing terms/i));
    await act(async () => { fireEvent.submit(screen.getByRole('button', { name: /securely connect a card/i }).closest('form')!); });

    expect(mocks.startBillingPaymentMethodSetup).toHaveBeenCalledWith(
      expect.objectContaining({ billingName: 'Test Customer', acceptsRecurringCharge: true }),
    );
    expect(assignSpy).toHaveBeenCalledWith('https://secure.cardcom.solutions/hosted/setup');
    assignSpy.mockRestore();
  });

  // ── Non-owner view ────────────────────────────────────────────────────────

  it('shows an owner-only message when the actor cannot manage billing', async () => {
    mocks.getBillingSubscription.mockResolvedValue({ ...sponsoredPlan, canManage: false });
    await renderPage();
    expect(await screen.findByText(/only the account owner can manage the payment method/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /securely connect a card/i })).not.toBeInTheDocument();
  });

  // ── Load error ────────────────────────────────────────────────────────────

  it('shows a retry button when the subscription cannot be loaded', async () => {
    mocks.getBillingSubscription.mockRejectedValue(new Error('network error'));
    await renderPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

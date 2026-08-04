import { render, screen } from '@testing-library/react';
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

async function renderPage() {
  const i18n = initI18n();
  await i18n.changeLanguage('en');
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <BillingPage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

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
});

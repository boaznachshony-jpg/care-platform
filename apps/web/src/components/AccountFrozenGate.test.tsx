import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import type { BillingPlanResponse } from '@caredesk/schemas';

const mocks = vi.hoisted(() => ({
  getBillingSubscription: vi.fn(),
  signOut: vi.fn(async () => true),
}));

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return { ...actual, getBillingSubscription: mocks.getBillingSubscription };
});

vi.mock('../auth/auth-context.js', () => ({
  useAuth: () => ({ user: { email: 'owner@example.test' }, signOut: mocks.signOut }),
}));

import { AccountFrozenGate, resetAccountFrozenGateCache } from './AccountFrozenGate.js';

function plan(overrides: Partial<BillingPlanResponse> = {}): BillingPlanResponse {
  return {
    status: 'sponsored',
    currency: 'ILS',
    interval: 'month',
    priceAgorot: 3900,
    netAgorot: 3305,
    vatAgorot: 595,
    vatRatePercent: 18,
    includesVat: true,
    launchDiscountPercent: 0,
    effectivePriceAgorot: 3900,
    chargingStartsAt: '2026-08-01',
    nextChargeOn: null,
    billingName: null,
    billingEmail: null,
    paymentMethod: null,
    canManage: true,
    providerConfigured: true,
    termsVersion: '2026-08-04',
    accessState: 'active',
    graceDaysRemaining: null,
    graceDays: 7,
    accessGraceStartsAt: null,
    ...overrides,
  };
}

async function renderGate(initialPath = '/app') {
  const i18n = initI18n();
  await i18n.changeLanguage('en');
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AccountFrozenGate>
          <p>protected content</p>
        </AccountFrozenGate>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('AccountFrozenGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAccountFrozenGateCache();
  });

  it('locks the app when the account is frozen and links to the billing page', async () => {
    mocks.getBillingSubscription.mockResolvedValue(plan({ accessState: 'frozen' }));
    await renderGate();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Account frozen' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Arrange payment' }).getAttribute('href')).toBe(
      '/billing',
    );
    expect(screen.queryByText('protected content')).toBeNull();
  });

  it('offers sign-out on the frozen screen', async () => {
    mocks.getBillingSubscription.mockResolvedValue(plan({ accessState: 'frozen' }));
    await renderGate();

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('never locks the billing page itself — the route that fixes the problem', async () => {
    mocks.getBillingSubscription.mockResolvedValue(plan({ accessState: 'frozen' }));
    await renderGate('/billing');

    expect(await screen.findByText('protected content')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Account frozen' })).toBeNull();
  });

  it('never locks the emergency binder — a frozen family may still need it tonight', async () => {
    mocks.getBillingSubscription.mockResolvedValue(plan({ accessState: 'frozen' }));
    await renderGate('/binder');

    expect(await screen.findByText('protected content')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Account frozen' })).toBeNull();
  });

  it('never locks the per-client emergency binder route either', async () => {
    mocks.getBillingSubscription.mockResolvedValue(plan({ accessState: 'frozen' }));
    await renderGate('/clients/client-1/binder');

    expect(await screen.findByText('protected content')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Account frozen' })).toBeNull();
  });

  it('shows a non-blocking warning with the remaining days during the grace window', async () => {
    mocks.getBillingSubscription.mockResolvedValue(
      plan({ accessState: 'grace', graceDaysRemaining: 3 }),
    );
    await renderGate();

    const banner = await screen.findByRole('status');
    expect(banner.textContent).toContain('3 days remain');
    expect(
      screen.getByRole('link', { name: 'Connect a payment method' }).getAttribute('href'),
    ).toBe('/billing');
    expect(screen.getByText('protected content')).toBeTruthy();
  });

  it('warns without freezing when the last charge failed (past_due)', async () => {
    // A declined charge keeps the payment method on file, so accessState stays
    // 'active' — the past_due warning is driven by the subscription status.
    mocks.getBillingSubscription.mockResolvedValue(
      plan({
        status: 'past_due',
        paymentMethod: { last4: '4242', expiryMonth: 12, expiryYear: 2030 },
        nextChargeOn: '2026-08-01',
      }),
    );
    await renderGate();

    const banner = await screen.findByRole('status');
    expect(banner.textContent).toContain('The last subscription charge failed');
    expect(screen.getByRole('link', { name: 'Update payment method' }).getAttribute('href')).toBe(
      '/billing',
    );
    // Never an immediate hard freeze on a first failed charge.
    expect(screen.getByText('protected content')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Account frozen' })).toBeNull();
  });

  it('does not show the past_due banner on the billing page itself', async () => {
    mocks.getBillingSubscription.mockResolvedValue(
      plan({
        status: 'past_due',
        paymentMethod: { last4: '4242', expiryMonth: 12, expiryYear: 2030 },
      }),
    );
    await renderGate('/billing');

    expect(await screen.findByText('protected content')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders children without a banner when the account is active', async () => {
    mocks.getBillingSubscription.mockResolvedValue(plan());
    await renderGate();

    expect(await screen.findByText('protected content')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('fails open when the billing status cannot be fetched', async () => {
    mocks.getBillingSubscription.mockRejectedValue(new Error('network blip'));
    await renderGate();

    expect(await screen.findByText('protected content')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Account frozen' })).toBeNull();
  });

  it('fetches the billing status once per session, not once per mount', async () => {
    mocks.getBillingSubscription.mockResolvedValue(plan());
    const first = await renderGate();
    expect(await first.findByText('protected content')).toBeTruthy();
    first.unmount();

    const second = await renderGate();
    expect(await second.findByText('protected content')).toBeTruthy();
    expect(mocks.getBillingSubscription).toHaveBeenCalledTimes(1);
  });
});

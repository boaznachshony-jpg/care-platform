import { describe, expect, it } from 'vitest';
import type { BillingPlanResponse } from '@caredesk/schemas';
import { BILLING_TERMS_VERSION } from '@caredesk/schemas';
import { DEV_TOKEN } from '../container.js';
import { buildServer } from '../create-server.js';
import { loadEnv } from '../env.js';

const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };
const CRON_SECRET = 'test-cron-secret-at-least-24-characters';

describe('/billing routes', () => {
  it('enforces MFA for billing mutations when the rollout policy is enabled', async () => {
    const app = buildServer(
      loadEnv({ BILLING_PROVIDER: 'mock', SENSITIVE_OPERATION_MFA_MODE: 'enforce' }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/billing/payment-method/setup',
      headers: AUTH,
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'MFA_REQUIRED' });
  });

  it('shows the 39 ILS VAT-inclusive plan with a 100% pilot discount', async () => {
    const app = buildServer(loadEnv({ BILLING_PROVIDER: 'mock' }));
    const response = await app.inject({
      method: 'GET',
      url: '/billing/subscription',
      headers: AUTH,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<BillingPlanResponse>()).toMatchObject({
      priceAgorot: 3900,
      netAgorot: 3305,
      vatAgorot: 595,
      vatRatePercent: 18,
      launchDiscountPercent: 100,
      effectivePriceAgorot: 0,
      chargingStartsAt: null,
      providerConfigured: true,
      canManage: true,
    });
  });

  it('uses hosted setup, verifies the webhook and never creates a charge while sponsored', async () => {
    const app = buildServer(loadEnv({ BILLING_PROVIDER: 'mock', CRON_SECRET }));
    const setup = await app.inject({
      method: 'POST',
      url: '/billing/payment-method/setup',
      headers: AUTH,
      payload: {
        billingName: 'Pilot Customer',
        billingEmail: 'pilot@example.test',
        acceptsRecurringCharge: true,
        termsVersion: BILLING_TERMS_VERSION,
      },
    });
    expect(setup.statusCode).toBe(201);
    expect(setup.json()).toMatchObject({ checkoutUrl: 'https://payments.example.test/setup' });

    const webhook = await app.inject({
      method: 'POST',
      url: '/billing/webhooks/cardcom',
      payload: { LowProfileId: '10000000-0000-4000-8000-000000000001' },
    });
    expect(webhook.statusCode).toBe(200);

    const plan = await app.inject({
      method: 'GET',
      url: '/billing/subscription',
      headers: AUTH,
    });
    expect(plan.json<BillingPlanResponse>()).toMatchObject({
      status: 'sponsored',
      effectivePriceAgorot: 0,
      paymentMethod: { last4: '4242' },
    });

    const collection = await app.inject({
      method: 'GET',
      url: '/billing/jobs/collect',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(collection.statusCode).toBe(200);
    expect(collection.json()).toEqual({ processed: 0, succeeded: 0, failed: 0 });
  });

  it('rejects invalid recurring consent and unauthorized cron calls', async () => {
    const app = buildServer(loadEnv({ BILLING_PROVIDER: 'mock', CRON_SECRET }));
    const setup = await app.inject({
      method: 'POST',
      url: '/billing/payment-method/setup',
      headers: AUTH,
      payload: {
        billingName: 'Pilot Customer',
        billingEmail: 'pilot@example.test',
        acceptsRecurringCharge: false,
        termsVersion: BILLING_TERMS_VERSION,
      },
    });
    expect(setup.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/billing/jobs/collect' })).statusCode).toBe(
      401,
    );
  });

  it('lets the owner cancel and removes the saved payment method', async () => {
    const app = buildServer(loadEnv({ BILLING_PROVIDER: 'mock' }));
    await app.inject({
      method: 'POST',
      url: '/billing/payment-method/setup',
      headers: AUTH,
      payload: {
        billingName: 'Pilot Customer',
        billingEmail: 'pilot@example.test',
        acceptsRecurringCharge: true,
        termsVersion: BILLING_TERMS_VERSION,
      },
    });
    await app.inject({
      method: 'POST',
      url: '/billing/webhooks/cardcom',
      payload: { LowProfileId: '10000000-0000-4000-8000-000000000001' },
    });

    expect(
      (await app.inject({ method: 'DELETE', url: '/billing/subscription', headers: AUTH }))
        .statusCode,
    ).toBe(204);
    const plan = await app.inject({
      method: 'GET',
      url: '/billing/subscription',
      headers: AUTH,
    });
    expect(plan.json<BillingPlanResponse>()).toMatchObject({
      status: 'cancelled',
      paymentMethod: null,
      nextChargeOn: null,
    });
  });
});

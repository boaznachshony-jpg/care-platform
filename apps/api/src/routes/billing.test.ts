import { describe, expect, it } from 'vitest';
import type { AuthorizationService, BillingDefaults } from '@caredesk/application';
import { CollectDueProductSubscriptions } from '@caredesk/application';
import {
  InMemoryAuditService,
  InMemoryBillingRepository,
  MockProductBillingGateway,
} from '@caredesk/infrastructure';
import type { BillingPlanResponse } from '@caredesk/schemas';
import { BILLING_TERMS_VERSION } from '@caredesk/schemas';
import { buildContainer, DEV_TOKEN } from '../container.js';
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
      accessState: 'active',
      graceDaysRemaining: null,
    });
  });

  it('derives an active access state while the tenant is fully sponsored', async () => {
    const app = buildServer(
      loadEnv({ BILLING_PROVIDER: 'mock', BILLING_LAUNCH_DISCOUNT_PERCENT: '0' }),
    );
    const response = await app.inject({
      method: 'GET',
      url: '/billing/subscription',
      headers: AUTH,
    });
    expect(response.statusCode).toBe(200);
    // Discount removed but no per-tenant charging start date: no charge-date
    // policy applies, so the account must stay usable.
    expect(response.json<BillingPlanResponse>()).toMatchObject({
      launchDiscountPercent: 0,
      chargingStartsAt: null,
      accessState: 'active',
      graceDaysRemaining: null,
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

  // ── Auth and security edge cases ──────────────────────────────────────────

  it('rejects GET /billing/subscription without a valid session token', async () => {
    const app = buildServer(loadEnv({ BILLING_PROVIDER: 'mock' }));
    const response = await app.inject({ method: 'GET', url: '/billing/subscription' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects DELETE /billing/subscription without a valid session token', async () => {
    const app = buildServer(loadEnv({ BILLING_PROVIDER: 'mock' }));
    const response = await app.inject({ method: 'DELETE', url: '/billing/subscription' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects the cron job when the secret is wrong', async () => {
    const app = buildServer(loadEnv({ BILLING_PROVIDER: 'mock', CRON_SECRET }));
    const response = await app.inject({
      method: 'GET',
      url: '/billing/jobs/collect',
      headers: { authorization: 'Bearer wrong-secret' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects the cron job when the Authorization header is absent', async () => {
    const app = buildServer(loadEnv({ BILLING_PROVIDER: 'mock', CRON_SECRET }));
    const response = await app.inject({ method: 'GET', url: '/billing/jobs/collect' });
    expect(response.statusCode).toBe(401);
  });

  // ── Webhook via query string ──────────────────────────────────────────────

  it('accepts the Cardcom webhook when LowProfileId arrives as a query parameter', async () => {
    const app = buildServer(loadEnv({ BILLING_PROVIDER: 'mock', CRON_SECRET }));
    // First create a setup so there is something to verify
    await app.inject({
      method: 'POST',
      url: '/billing/payment-method/setup',
      headers: AUTH,
      payload: {
        billingName: 'Query Param Customer',
        billingEmail: 'qp@example.test',
        acceptsRecurringCharge: true,
        termsVersion: BILLING_TERMS_VERSION,
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/billing/webhooks/cardcom?LowProfileId=10000000-0000-4000-8000-000000000001',
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ received: true });
  });

  it('returns 400 when the Cardcom webhook contains no recognisable LowProfileId', async () => {
    const app = buildServer(loadEnv({ BILLING_PROVIDER: 'mock' }));
    const response = await app.inject({
      method: 'POST',
      url: '/billing/webhooks/cardcom',
      payload: { unrelated: 'field' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'INVALID_BILLING_WEBHOOK' });
  });
});

// ── Recurring charge execution (the cron-driven collection run) ─────────────

const CHARGE_DEFAULTS: BillingDefaults = {
  priceAgorot: 3900,
  vatRateBps: 1800,
  launchDiscountPercent: 0,
  chargingStartsAt: '2026-08-01',
};

const SEALED_TOKEN = 'sealed.synthetic.token';

/**
 * Builds the real server with the real collect route, but wires the collection
 * use case to a seeded in-memory repository whose claim/succeed/fail semantics
 * mirror the SQL functions in migration 0014 — one durable charge per
 * (tenant, billing period) is what makes replays idempotent.
 */
async function buildCollectionHarness(billingEmail: string) {
  const env = loadEnv({ BILLING_PROVIDER: 'mock', CRON_SECRET });
  const billing = new InMemoryBillingRepository();
  const audit = new InMemoryAuditService();
  const authorization: AuthorizationService = {
    check: async () => ({ allowed: true, reason: 'test' }),
  };

  await billing.getOrCreate('tenant-1', CHARGE_DEFAULTS);
  await billing.createSetupIntent({
    intentId: 'intent-1',
    tenantId: 'tenant-1',
    createdBy: 'user-1',
    billingName: 'Pilot Customer',
    billingEmail,
    termsVersion: BILLING_TERMS_VERSION,
    termsAcceptedAt: '2026-07-01T00:00:00.000Z',
    providerSetupId: null,
    status: 'created',
  });
  await billing.attachProviderSetup('tenant-1', 'intent-1', 'setup-1');
  await billing.completePaymentMethodSetup('tenant-1', 'intent-1', {
    providerSetupId: 'setup-1',
    sealedToken: SEALED_TOKEN,
    expiryMonth: 12,
    expiryYear: 2030,
    last4: '4242',
  });

  const container = buildContainer(env);
  container.collectDueProductSubscriptions = new CollectDueProductSubscriptions({
    authorization,
    billing,
    gateway: new MockProductBillingGateway(),
    audit,
    clock: { now: () => new Date('2026-08-21T04:17:00.000Z') },
    ids: { next: () => 'id-1' },
    defaults: CHARGE_DEFAULTS,
  });
  const app = buildServer(env, container);
  const collect = () =>
    app.inject({
      method: 'GET',
      url: '/billing/jobs/collect',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
  const subscription = () => billing.getOrCreate('tenant-1', CHARGE_DEFAULTS);
  return { app, billing, audit, collect, subscription };
}

describe('recurring charge collection run', () => {
  it('activates the subscription and advances next_charge_on when the charge succeeds', async () => {
    const { collect, subscription, audit } = await buildCollectionHarness('pilot@example.test');

    const run = await collect();
    expect(run.statusCode).toBe(200);
    expect(run.json()).toEqual({ processed: 1, succeeded: 1, failed: 0 });

    const record = await subscription();
    expect(record.status).toBe('active');
    expect(record.nextChargeOn).toBe('2026-09-01');
    expect(audit.events.some((event) => event.action === 'billing.charge_succeeded')).toBe(true);
  });

  it('marks the subscription past_due without advancing next_charge_on when the charge declines', async () => {
    const { collect, subscription, audit } = await buildCollectionHarness('decline@example.test');

    const run = await collect();
    expect(run.statusCode).toBe(200);
    expect(run.json()).toEqual({ processed: 1, succeeded: 0, failed: 1 });

    const record = await subscription();
    // A failed charge must never present as an active subscription.
    expect(record.status).toBe('past_due');
    // The failed period stays due so it is retried — never silently skipped.
    expect(record.nextChargeOn).toBe('2026-08-01');

    const failedEvent = audit.events.find((event) => event.action === 'billing.charge_failed');
    expect(failedEvent).toMatchObject({
      tenantId: 'tenant-1',
      actorId: null,
      sensitivity: 'financial_sensitive',
    });
    expect(failedEvent!.changeSummary).toContain('MOCK_DECLINED');
    // Provider code only — no card data in the audit evidence.
    const serialized = JSON.stringify(audit.events);
    expect(serialized).not.toContain(SEALED_TOKEN);
    expect(serialized).not.toContain('4242');
  });

  it('is replay-idempotent: a rerun after success charges nothing for the same period', async () => {
    const { collect, subscription } = await buildCollectionHarness('pilot@example.test');

    expect((await collect()).json()).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    // Same day, same period — already collected, so the rerun is a no-op.
    expect((await collect()).json()).toEqual({ processed: 0, succeeded: 0, failed: 0 });

    const record = await subscription();
    expect(record.status).toBe('active');
    expect(record.nextChargeOn).toBe('2026-09-01');
  });

  it('retries a failed period on later runs but stops after three attempts', async () => {
    const { collect, subscription } = await buildCollectionHarness('decline@example.test');

    expect((await collect()).json()).toEqual({ processed: 1, succeeded: 0, failed: 1 });
    expect((await collect()).json()).toEqual({ processed: 1, succeeded: 0, failed: 1 });
    expect((await collect()).json()).toEqual({ processed: 1, succeeded: 0, failed: 1 });
    // Attempts are capped at three per period, exactly like migration 0014.
    expect((await collect()).json()).toEqual({ processed: 0, succeeded: 0, failed: 0 });

    const record = await subscription();
    expect(record.status).toBe('past_due');
    expect(record.nextChargeOn).toBe('2026-08-01');
  });
});

import { describe, expect, it } from 'vitest';
import type {
  AuditEventInput,
  AuditService,
  AuthorizationService,
  BillingRepository,
  DueBillingCharge,
  ProductBillingGateway,
} from '../index.js';
import { CollectDueProductSubscriptions } from './manage-product-billing.js';

const SEALED_TOKEN = 'sealed.synthetic.token';
const LAST4 = '4242';

function dueCharge(): DueBillingCharge {
  return {
    chargeId: 'charge-1',
    tenantId: 'tenant-1',
    billingPeriod: '2026-08-01',
    externalUniqId: 'caredesk-tenant-1-2026-08-01',
    amountAgorot: 3900,
    billingName: 'Pilot Customer',
    billingEmail: 'pilot@example.test',
    paymentMethod: {
      providerSetupId: 'setup-1',
      sealedToken: SEALED_TOKEN,
      expiryMonth: 12,
      expiryYear: 2030,
      last4: LAST4,
    },
  };
}

/**
 * Minimal repository fake: serves one claimed due charge and records which
 * outcome the use case reported for it. The past_due/next_charge_on state
 * transitions themselves live in SQL (0014) and in the in-memory mock that
 * mirrors it — this test pins the use case's orchestration contract.
 */
function makeRepository(charges: DueBillingCharge[]) {
  const calls = {
    succeeded: [] as { chargeId: string; providerTransactionId: string }[],
    failed: [] as { chargeId: string; failureCode: string }[],
  };
  const repository: BillingRepository = {
    getOrCreate: () => Promise.reject(new Error('unused')),
    createSetupIntent: () => Promise.reject(new Error('unused')),
    attachProviderSetup: () => Promise.reject(new Error('unused')),
    findSetupIntentByProviderId: () => Promise.reject(new Error('unused')),
    completePaymentMethodSetup: () => Promise.reject(new Error('unused')),
    failPaymentMethodSetup: () => Promise.reject(new Error('unused')),
    cancel: () => Promise.reject(new Error('unused')),
    claimDueCharges: async () => charges,
    markChargeSucceeded: async (chargeId, providerTransactionId) => {
      calls.succeeded.push({ chargeId, providerTransactionId });
    },
    markChargeFailed: async (chargeId, failureCode) => {
      calls.failed.push({ chargeId, failureCode });
    },
  };
  return { repository, calls };
}

function makeDeps(charges: DueBillingCharge[], gateway: ProductBillingGateway) {
  const { repository, calls } = makeRepository(charges);
  const auditEvents: AuditEventInput[] = [];
  const audit: AuditService = {
    record: async (event) => {
      auditEvents.push(event);
    },
  };
  const authorization: AuthorizationService = {
    check: async () => ({ allowed: true, reason: 'test' }),
  };
  const deps = {
    authorization,
    billing: repository,
    gateway,
    audit,
    clock: { now: () => new Date('2026-08-21T04:17:00.000Z') },
    ids: { next: () => 'id-1' },
    defaults: {
      priceAgorot: 3900,
      vatRateBps: 1800,
      launchDiscountPercent: 0,
      chargingStartsAt: null,
    },
  };
  return { deps, calls, auditEvents };
}

function decliningGateway(): ProductBillingGateway {
  return {
    configured: true,
    createPaymentMethodSetup: () => Promise.reject(new Error('unused')),
    verifyPaymentMethodSetup: () => Promise.reject(new Error('unused')),
    chargeMonthly: async () => {
      const error = new Error('Cardcom rejected the operation.');
      error.name = 'CardcomGatewayError';
      throw Object.assign(error, { providerCode: '33' });
    },
  };
}

function approvingGateway(): ProductBillingGateway {
  return {
    configured: true,
    createPaymentMethodSetup: () => Promise.reject(new Error('unused')),
    verifyPaymentMethodSetup: () => Promise.reject(new Error('unused')),
    chargeMonthly: async (input) => ({ providerTransactionId: `tx-${input.externalUniqId}` }),
  };
}

describe('CollectDueProductSubscriptions', () => {
  it('marks a declined charge failed (never succeeded) and audits billing.charge_failed', async () => {
    const { deps, calls, auditEvents } = makeDeps([dueCharge()], decliningGateway());
    const summary = await new CollectDueProductSubscriptions(deps).execute();

    expect(summary).toEqual({ processed: 1, succeeded: 0, failed: 1 });
    expect(calls.succeeded).toHaveLength(0);
    // The repository contract behind markChargeFailed (SQL 0014) flips the
    // subscription to past_due and leaves next_charge_on untouched.
    expect(calls.failed).toEqual([{ chargeId: 'charge-1', failureCode: '33' }]);

    const failedEvents = auditEvents.filter((event) => event.action === 'billing.charge_failed');
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0]).toMatchObject({
      tenantId: 'tenant-1',
      actorId: null,
      resourceType: 'billing_subscription',
      resourceId: 'tenant-1',
      correlationId: 'caredesk-tenant-1-2026-08-01',
      sensitivity: 'financial_sensitive',
    });
    expect(failedEvents[0]!.changeSummary).toContain('provider code 33');
    expect(failedEvents[0]!.changeSummary).toContain('past_due');
  });

  it('never leaks card data into the audit evidence', async () => {
    const { deps, auditEvents } = makeDeps([dueCharge()], decliningGateway());
    await new CollectDueProductSubscriptions(deps).execute();

    const serialized = JSON.stringify(auditEvents);
    expect(serialized).not.toContain(SEALED_TOKEN);
    expect(serialized).not.toContain(LAST4);
    expect(serialized).not.toContain('pilot@example.test');
  });

  it('marks a successful charge succeeded and audits billing.charge_succeeded', async () => {
    const { deps, calls, auditEvents } = makeDeps([dueCharge()], approvingGateway());
    const summary = await new CollectDueProductSubscriptions(deps).execute();

    expect(summary).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(calls.failed).toHaveLength(0);
    expect(calls.succeeded).toEqual([
      { chargeId: 'charge-1', providerTransactionId: 'tx-caredesk-tenant-1-2026-08-01' },
    ]);

    const succeededEvents = auditEvents.filter(
      (event) => event.action === 'billing.charge_succeeded',
    );
    expect(succeededEvents).toHaveLength(1);
    expect(succeededEvents[0]).toMatchObject({
      tenantId: 'tenant-1',
      actorId: null,
      correlationId: 'caredesk-tenant-1-2026-08-01',
      sensitivity: 'financial_sensitive',
    });
  });

  it('falls back to the error name when a failure carries no provider code', async () => {
    const gateway: ProductBillingGateway = {
      configured: true,
      createPaymentMethodSetup: () => Promise.reject(new Error('unused')),
      verifyPaymentMethodSetup: () => Promise.reject(new Error('unused')),
      chargeMonthly: async () => {
        throw new TypeError('fetch failed');
      },
    };
    const { deps, calls } = makeDeps([dueCharge()], gateway);
    await new CollectDueProductSubscriptions(deps).execute();
    expect(calls.failed).toEqual([{ chargeId: 'charge-1', failureCode: 'TypeError' }]);
  });
});

import { PRODUCT_BILLING_TERMS_VERSION, type ProductSubscriptionStatus } from '@caredesk/domain';
import type { AuditService } from '../ports/audit-service.js';
import type { BillingDefaults, BillingRepository } from '../ports/billing-repository.js';
import type { AuthorizationService } from '../ports/authorization-service.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { ProductBillingGateway } from '../ports/product-billing-gateway.js';
import type { Actor } from './actor.js';
import { authorizeOrThrow } from './authorize.js';

interface BillingDeps {
  authorization: AuthorizationService;
  billing: BillingRepository;
  gateway: ProductBillingGateway;
  audit: AuditService;
  clock: Clock;
  ids: IdGenerator;
  defaults: BillingDefaults;
}

export interface StartBillingSetupInput {
  billingName: string;
  billingEmail: string;
  acceptsRecurringCharge: true;
  termsVersion: string;
}

export interface ProductSubscriptionPlan {
  status: ProductSubscriptionStatus;
  currency: 'ILS';
  interval: 'month';
  priceAgorot: number;
  netAgorot: number;
  vatAgorot: number;
  vatRatePercent: number;
  includesVat: true;
  launchDiscountPercent: number;
  effectivePriceAgorot: number;
  chargingStartsAt: string | null;
  nextChargeOn: string | null;
  /** Cancellation-anchored grace start; see BillingAccessInput in the API. */
  accessGraceStartsAt: string | null;
  billingName: string | null;
  billingEmail: string | null;
  paymentMethod: { last4: string; expiryMonth: number; expiryYear: number } | null;
  canManage: boolean;
  providerConfigured: boolean;
  termsVersion: string;
}

export class BillingProviderUnavailableError extends Error {
  readonly code = 'BILLING_PROVIDER_UNAVAILABLE';
}

export class BillingSetupNotFoundError extends Error {
  readonly code = 'BILLING_SETUP_NOT_FOUND';
}

function toPlan(
  record: Awaited<ReturnType<BillingRepository['getOrCreate']>>,
  canManage: boolean,
  providerConfigured: boolean,
): ProductSubscriptionPlan {
  const netAgorot = Math.round(record.priceAgorot / (1 + record.vatRateBps / 10_000));
  return {
    status: record.status,
    currency: 'ILS',
    interval: 'month',
    priceAgorot: record.priceAgorot,
    netAgorot,
    vatAgorot: record.priceAgorot - netAgorot,
    vatRatePercent: record.vatRateBps / 100,
    includesVat: true,
    launchDiscountPercent: record.launchDiscountPercent,
    effectivePriceAgorot: Math.round(record.priceAgorot * (1 - record.launchDiscountPercent / 100)),
    chargingStartsAt: record.chargingStartsAt,
    nextChargeOn: record.nextChargeOn,
    accessGraceStartsAt: record.accessGraceStartsAt,
    billingName: record.billingName,
    billingEmail: record.billingEmail,
    paymentMethod: record.paymentMethod
      ? {
          last4: record.paymentMethod.last4,
          expiryMonth: record.paymentMethod.expiryMonth,
          expiryYear: record.paymentMethod.expiryYear,
        }
      : null,
    canManage,
    providerConfigured,
    termsVersion: PRODUCT_BILLING_TERMS_VERSION,
  };
}

export class GetProductSubscription {
  constructor(private readonly deps: BillingDeps) {}

  async execute(actor: Actor): Promise<ProductSubscriptionPlan> {
    await authorizeOrThrow(this.deps, actor, { resourceType: 'billing', action: 'read' });
    const manage = await this.deps.authorization.check({
      userId: actor.userId,
      tenantId: actor.tenantId,
      mfaSatisfied: actor.mfaSatisfied,
      resourceType: 'billing',
      action: 'manage',
    });
    const record = await this.deps.billing.getOrCreate(actor.tenantId, this.deps.defaults);
    return toPlan(record, manage.allowed, this.deps.gateway.configured);
  }
}

export class StartProductBillingSetup {
  constructor(private readonly deps: BillingDeps) {}

  async execute(actor: Actor, input: StartBillingSetupInput): Promise<{ checkoutUrl: string }> {
    await authorizeOrThrow(this.deps, actor, { resourceType: 'billing', action: 'manage' });
    if (!this.deps.gateway.configured) {
      throw new BillingProviderUnavailableError('The billing provider is not configured.');
    }
    const now = this.deps.clock.now().toISOString();
    const intentId = this.deps.ids.next();
    await this.deps.billing.getOrCreate(actor.tenantId, this.deps.defaults);
    await this.deps.billing.createSetupIntent({
      intentId,
      tenantId: actor.tenantId,
      createdBy: actor.userId,
      billingName: input.billingName,
      billingEmail: input.billingEmail,
      termsVersion: input.termsVersion,
      termsAcceptedAt: now,
      providerSetupId: null,
      status: 'created',
    });

    const session = await this.deps.gateway.createPaymentMethodSetup({
      intentId,
      billingName: input.billingName,
      billingEmail: input.billingEmail,
    });
    await this.deps.billing.attachProviderSetup(actor.tenantId, intentId, session.providerSetupId);
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'billing.payment_method.setup_started',
      resourceType: 'billing_subscription',
      resourceId: actor.tenantId,
      correlationId: actor.correlationId,
      occurredAt: now,
      changeSummary: `Recurring billing terms ${input.termsVersion} accepted; hosted payment-method setup started.`,
      sensitivity: 'financial_sensitive',
    });
    return { checkoutUrl: session.checkoutUrl };
  }
}

export class CompleteProductBillingSetup {
  constructor(private readonly deps: BillingDeps) {}

  async execute(providerSetupId: string): Promise<void> {
    if (!this.deps.gateway.configured) throw new BillingProviderUnavailableError();
    const verified = await this.deps.gateway.verifyPaymentMethodSetup(providerSetupId);
    const intent = await this.deps.billing.findSetupIntentByProviderId(providerSetupId);
    if (!intent || intent.intentId !== verified.returnValue) {
      throw new BillingSetupNotFoundError('Verified setup does not match a pending intent.');
    }
    if (intent.status === 'completed') return;
    await this.deps.billing.completePaymentMethodSetup(intent.tenantId, intent.intentId, {
      providerSetupId: verified.providerSetupId,
      sealedToken: verified.sealedToken,
      expiryMonth: verified.expiryMonth,
      expiryYear: verified.expiryYear,
      last4: verified.last4,
    });
    await this.deps.audit.record({
      tenantId: intent.tenantId,
      actorId: intent.createdBy,
      action: 'billing.payment_method.ready',
      resourceType: 'billing_subscription',
      resourceId: intent.tenantId,
      correlationId: `cardcom:${providerSetupId}`,
      occurredAt: this.deps.clock.now().toISOString(),
      changeSummary: 'Hosted payment-method setup verified server-to-server.',
      sensitivity: 'financial_sensitive',
    });
  }
}

/**
 * Extracts a short provider error code for the audit trail. Never card data:
 * gateway errors carry a `providerCode` (e.g. a Cardcom ResponseCode) or at
 * worst an error class name — both are safe, length-capped identifiers.
 */
function chargeFailureCode(error: unknown): string {
  if (error && typeof error === 'object' && 'providerCode' in error) {
    const code = (error as { providerCode: unknown }).providerCode;
    if (typeof code === 'string' && code.length > 0) return code.slice(0, 60);
  }
  return error instanceof Error ? error.name : 'BILLING_CHARGE_FAILED';
}

export class CollectDueProductSubscriptions {
  constructor(private readonly deps: BillingDeps) {}

  async execute(limit = 25): Promise<{ processed: number; succeeded: number; failed: number }> {
    if (!this.deps.gateway.configured) throw new BillingProviderUnavailableError();
    const due = await this.deps.billing.claimDueCharges(this.deps.clock.now().toISOString(), limit);
    let succeeded = 0;
    let failed = 0;
    for (const charge of due) {
      // The Cardcom charge result is synchronous: a decline surfaces as a
      // thrown gateway error right here, not via a later webhook. The gateway
      // call is the only awaited step inside the try — marking the outcome and
      // auditing happen outside it so an audit hiccup can never turn a
      // succeeded charge into a recorded failure (or vice versa).
      let providerTransactionId: string | null = null;
      let failureCode = 'BILLING_CHARGE_FAILED';
      try {
        const result = await this.deps.gateway.chargeMonthly({
          externalUniqId: charge.externalUniqId,
          providerSetupId: charge.paymentMethod.providerSetupId,
          amountAgorot: charge.amountAgorot,
          billingName: charge.billingName,
          billingEmail: charge.billingEmail,
          sealedToken: charge.paymentMethod.sealedToken,
          expiryMonth: charge.paymentMethod.expiryMonth,
          expiryYear: charge.paymentMethod.expiryYear,
        });
        providerTransactionId = result.providerTransactionId;
      } catch (error) {
        failureCode = chargeFailureCode(error);
      }
      const occurredAt = this.deps.clock.now().toISOString();
      if (providerTransactionId !== null) {
        // markChargeSucceeded flips the subscription to 'active' and advances
        // next_charge_on by one month (fail path leaves next_charge_on alone).
        await this.deps.billing.markChargeSucceeded(charge.chargeId, providerTransactionId);
        succeeded += 1;
        await this.deps.audit.record({
          tenantId: charge.tenantId,
          actorId: null, // system cron; no human actor.
          action: 'billing.charge_succeeded',
          resourceType: 'billing_subscription',
          resourceId: charge.tenantId,
          correlationId: charge.externalUniqId,
          occurredAt,
          changeSummary: `Monthly subscription charge for ${charge.billingPeriod} succeeded.`,
          sensitivity: 'financial_sensitive',
        });
      } else {
        // markChargeFailed flips the subscription to 'past_due' and does NOT
        // advance next_charge_on, so the same period is retried (max 3
        // attempts) and the UI stops presenting the account as active.
        await this.deps.billing.markChargeFailed(charge.chargeId, failureCode);
        failed += 1;
        await this.deps.audit.record({
          tenantId: charge.tenantId,
          actorId: null, // system cron; no human actor.
          action: 'billing.charge_failed',
          resourceType: 'billing_subscription',
          resourceId: charge.tenantId,
          correlationId: charge.externalUniqId,
          occurredAt,
          // Provider code only — never card data, tokens or amounts owed.
          changeSummary: `Monthly subscription charge for ${charge.billingPeriod} failed (provider code ${failureCode}); subscription marked past_due.`,
          sensitivity: 'financial_sensitive',
        });
      }
    }
    return { processed: due.length, succeeded, failed };
  }
}

export class CancelProductSubscription {
  constructor(private readonly deps: BillingDeps) {}

  async execute(actor: Actor): Promise<void> {
    await authorizeOrThrow(this.deps, actor, { resourceType: 'billing', action: 'manage' });
    const now = this.deps.clock.now().toISOString();
    await this.deps.billing.cancel(actor.tenantId, now);
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'billing.subscription.cancelled',
      resourceType: 'billing_subscription',
      resourceId: actor.tenantId,
      correlationId: actor.correlationId,
      occurredAt: now,
      changeSummary:
        'Product subscription cancelled; payment token removed and future charges stopped.',
      sensitivity: 'financial_sensitive',
    });
  }
}

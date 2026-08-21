import type {
  BillingDefaults,
  BillingRepository,
  BillingSetupIntentRecord,
  DueBillingCharge,
  ProductSubscriptionRecord,
  StoredPaymentMethod,
} from '@caredesk/application';

interface InMemoryChargeRecord {
  chargeId: string;
  tenantId: string;
  billingPeriod: string;
  externalUniqId: string;
  amountAgorot: number;
  status: 'processing' | 'succeeded' | 'failed';
  attempts: number;
  providerTransactionId: string | null;
  failureCode: string | null;
}

/** Mirrors the SQL `(v_period + interval '1 month')::date` advance. */
function addOneMonth(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

/** Synthetic/test-only billing store. It never contains real payment details. */
export class InMemoryBillingRepository implements BillingRepository {
  private readonly subscriptions = new Map<string, ProductSubscriptionRecord>();
  private readonly intents = new Map<string, BillingSetupIntentRecord>();
  /** Keyed by `${tenantId}:${billingPeriod}` — same uniqueness as the table. */
  private readonly charges = new Map<string, InMemoryChargeRecord>();
  private chargeSequence = 0;

  async getOrCreate(
    tenantId: string,
    defaults: BillingDefaults,
  ): Promise<ProductSubscriptionRecord> {
    let record = this.subscriptions.get(tenantId);
    if (!record) {
      record = {
        tenantId,
        status: 'sponsored',
        ...defaults,
        nextChargeOn: defaults.chargingStartsAt,
        billingName: null,
        billingEmail: null,
        termsVersion: null,
        termsAcceptedAt: null,
        paymentMethod: null,
      };
      this.subscriptions.set(tenantId, record);
    }
    return structuredClone(record);
  }

  async createSetupIntent(intent: BillingSetupIntentRecord): Promise<void> {
    this.intents.set(intent.intentId, structuredClone(intent));
  }

  async attachProviderSetup(
    _tenantId: string,
    intentId: string,
    providerSetupId: string,
  ): Promise<void> {
    const intent = this.intents.get(intentId);
    if (!intent) throw new Error('Billing setup intent not found.');
    intent.providerSetupId = providerSetupId;
    intent.status = 'pending';
    const subscription = this.subscriptions.get(intent.tenantId);
    if (subscription) subscription.status = 'payment_method_pending';
  }

  async findSetupIntentByProviderId(
    providerSetupId: string,
  ): Promise<BillingSetupIntentRecord | null> {
    const found = [...this.intents.values()].find(
      (intent) => intent.providerSetupId === providerSetupId,
    );
    return found ? structuredClone(found) : null;
  }

  async completePaymentMethodSetup(
    _tenantId: string,
    intentId: string,
    paymentMethod: StoredPaymentMethod,
  ): Promise<ProductSubscriptionRecord> {
    const intent = this.intents.get(intentId);
    if (!intent) throw new Error('Billing setup intent not found.');
    const subscription = this.subscriptions.get(intent.tenantId);
    if (!subscription) throw new Error('Product subscription not found.');
    intent.status = 'completed';
    subscription.billingName = intent.billingName;
    subscription.billingEmail = intent.billingEmail;
    subscription.termsVersion = intent.termsVersion;
    subscription.termsAcceptedAt = intent.termsAcceptedAt;
    subscription.paymentMethod = structuredClone(paymentMethod);
    subscription.status = subscription.chargingStartsAt ? 'payment_method_ready' : 'sponsored';
    return structuredClone(subscription);
  }

  async failPaymentMethodSetup(_tenantId: string, intentId: string): Promise<void> {
    const intent = this.intents.get(intentId);
    if (intent) intent.status = 'failed';
  }

  async cancel(tenantId: string, _cancelledAt: string): Promise<void> {
    const subscription = this.subscriptions.get(tenantId);
    if (!subscription) return;
    subscription.status = 'cancelled';
    subscription.nextChargeOn = null;
    subscription.paymentMethod = null;
  }

  /**
   * Faithful in-memory port of `claim_caredesk_product_billing_charges`
   * (database/migrations/0014_product_billing.sql): one durable charge row per
   * (tenant, billing period), re-claimable only after a failure and only up to
   * three attempts — which is what makes the collection job replay-idempotent.
   */
  async claimDueCharges(now: string, limit: number): Promise<DueBillingCharge[]> {
    const today = now.slice(0, 10);
    const claimed: DueBillingCharge[] = [];
    const due = [...this.subscriptions.values()]
      .filter(
        (subscription) =>
          ['payment_method_ready', 'active', 'past_due'].includes(subscription.status) &&
          subscription.launchDiscountPercent === 0 &&
          subscription.chargingStartsAt !== null &&
          subscription.chargingStartsAt <= today &&
          subscription.nextChargeOn !== null &&
          subscription.nextChargeOn <= today &&
          subscription.paymentMethod !== null &&
          subscription.billingName !== null &&
          subscription.billingEmail !== null,
      )
      .sort((a, b) => (a.nextChargeOn! < b.nextChargeOn! ? -1 : 1));
    for (const subscription of due) {
      if (claimed.length >= Math.max(1, Math.min(limit, 100))) break;
      const period = subscription.nextChargeOn!;
      const key = `${subscription.tenantId}:${period}`;
      let charge = this.charges.get(key);
      if (!charge) {
        this.chargeSequence += 1;
        charge = {
          chargeId: `charge-${this.chargeSequence}`,
          tenantId: subscription.tenantId,
          billingPeriod: period,
          externalUniqId: `caredesk-${subscription.tenantId}-${period}`,
          amountAgorot: subscription.priceAgorot,
          status: 'processing',
          attempts: 1,
          providerTransactionId: null,
          failureCode: null,
        };
        this.charges.set(key, charge);
      } else if (charge.status === 'failed' && charge.attempts < 3) {
        charge.status = 'processing';
        charge.attempts += 1;
        charge.failureCode = null;
      } else {
        // Succeeded, still processing, or out of attempts: not re-claimable.
        continue;
      }
      claimed.push({
        chargeId: charge.chargeId,
        tenantId: subscription.tenantId,
        billingPeriod: period,
        externalUniqId: charge.externalUniqId,
        amountAgorot: charge.amountAgorot,
        billingName: subscription.billingName!,
        billingEmail: subscription.billingEmail!,
        paymentMethod: structuredClone(subscription.paymentMethod!),
      });
    }
    return claimed;
  }

  async markChargeSucceeded(chargeId: string, providerTransactionId: string): Promise<void> {
    const charge = [...this.charges.values()].find(
      (candidate) => candidate.chargeId === chargeId && candidate.status === 'processing',
    );
    if (!charge) return;
    charge.status = 'succeeded';
    charge.providerTransactionId = providerTransactionId;
    charge.failureCode = null;
    const subscription = this.subscriptions.get(charge.tenantId);
    if (!subscription) return;
    subscription.status = 'active';
    subscription.nextChargeOn = addOneMonth(charge.billingPeriod);
  }

  async markChargeFailed(chargeId: string, failureCode: string): Promise<void> {
    const charge = [...this.charges.values()].find(
      (candidate) => candidate.chargeId === chargeId && candidate.status === 'processing',
    );
    if (!charge) return;
    charge.status = 'failed';
    charge.failureCode = failureCode.slice(0, 120);
    const subscription = this.subscriptions.get(charge.tenantId);
    if (!subscription) return;
    // Deliberately does NOT advance nextChargeOn: the failed period stays due
    // and the subscription must present as past_due, never as active.
    subscription.status = 'past_due';
  }
}

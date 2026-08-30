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
  attemptCycle: number;
  /**
   * Mirrors product_billing_charge.payment_method_refreshed_at. The SQL stores
   * a timestamp; here it is the monotonic revision below, so the "is this card
   * newer than the one that failed?" comparison cannot be made flaky by two
   * writes landing in the same millisecond.
   */
  paymentMethodRevision: number | null;
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
  /**
   * The SQL uses `current_date` when it restores a charge date; the fake needs
   * the same clock the collection run uses, or a restored date could land after
   * the run's "today" and look uncollectable for reasons the code never has.
   */
  constructor(private readonly clock: () => Date = () => new Date()) {}

  private readonly subscriptions = new Map<string, ProductSubscriptionRecord>();
  private readonly intents = new Map<string, BillingSetupIntentRecord>();
  /** Keyed by `${tenantId}:${billingPeriod}` — same uniqueness as the table. */
  private readonly charges = new Map<string, InMemoryChargeRecord>();
  private chargeSequence = 0;
  /** Stand-in for product_subscription.payment_method_updated_at, per tenant. */
  private readonly paymentMethodRevisions = new Map<string, number>();
  private paymentMethodSequence = 0;

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
        accessGraceStartsAt: null,
        pendingSetupStartedAt: null,
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
    if (!subscription) return;
    subscription.pendingSetupStartedAt = new Date().toISOString();
    // Mirrors the SQL guard: only a subscription with no stored card can be
    // moved to 'payment_method_pending'. Opening a checkout must never take a
    // customer who already has a working card out of the collection run.
    if (!subscription.paymentMethod) subscription.status = 'payment_method_pending';
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
    // Restores a real charge date after a cancellation cleared it — otherwise
    // re-adding a card buys unlimited free service (mirrors the SQL `greatest`).
    if (subscription.chargingStartsAt && subscription.nextChargeOn === null) {
      const today = this.clock().toISOString().slice(0, 10);
      subscription.nextChargeOn =
        subscription.chargingStartsAt > today ? subscription.chargingStartsAt : today;
    }
    subscription.accessGraceStartsAt = null;
    subscription.pendingSetupStartedAt = null;
    this.paymentMethodSequence += 1;
    this.paymentMethodRevisions.set(intent.tenantId, this.paymentMethodSequence);
    return structuredClone(subscription);
  }

  async failPaymentMethodSetup(_tenantId: string, intentId: string): Promise<void> {
    const intent = this.intents.get(intentId);
    if (intent) intent.status = 'failed';
  }

  async cancel(tenantId: string, cancelledAt: string): Promise<void> {
    const subscription = this.subscriptions.get(tenantId);
    if (!subscription) return;
    subscription.status = 'cancelled';
    subscription.nextChargeOn = null;
    subscription.paymentMethod = null;
    subscription.pendingSetupStartedAt = null;
    // Removing the card is the moment a payment method becomes necessary, so
    // the grace window starts here rather than at the historic charging date.
    subscription.accessGraceStartsAt = cancelledAt.slice(0, 10);
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
      const revision = this.paymentMethodRevisions.get(subscription.tenantId) ?? null;
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
          attemptCycle: 1,
          paymentMethodRevision: revision,
          providerTransactionId: null,
          failureCode: null,
        };
        this.charges.set(key, charge);
      } else if (charge.status === 'failed' && charge.attempts < 3) {
        charge.status = 'processing';
        charge.attempts += 1;
        charge.paymentMethodRevision = revision;
        charge.failureCode = null;
      } else if (
        charge.status === 'failed' &&
        // The exit from an exhausted period: the customer stored a payment
        // method newer than the one the failed cycle kept trying. Attempts
        // restart at 1 in a new cycle, exactly as the SQL does; nothing here
        // resets on time alone, so this cannot become an unattended retry loop.
        revision !== null &&
        (charge.paymentMethodRevision === null || revision > charge.paymentMethodRevision) &&
        charge.attemptCycle < 10
      ) {
        charge.status = 'processing';
        charge.attempts = 1;
        charge.attemptCycle += 1;
        charge.paymentMethodRevision = revision;
        charge.failureCode = null;
      } else {
        // Succeeded, still processing, or out of attempts with the same card.
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

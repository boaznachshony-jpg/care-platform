import type {
  BillingDefaults,
  BillingRepository,
  BillingSetupIntentRecord,
  DueBillingCharge,
  ProductSubscriptionRecord,
  StoredPaymentMethod,
} from '@caredesk/application';

/** Synthetic/test-only billing store. It never contains real payment details. */
export class InMemoryBillingRepository implements BillingRepository {
  private readonly subscriptions = new Map<string, ProductSubscriptionRecord>();
  private readonly intents = new Map<string, BillingSetupIntentRecord>();

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

  async claimDueCharges(_now: string, _limit: number): Promise<DueBillingCharge[]> {
    return [];
  }

  async markChargeSucceeded(_chargeId: string, _providerTransactionId: string): Promise<void> {}

  async markChargeFailed(_chargeId: string, _failureCode: string): Promise<void> {}
}

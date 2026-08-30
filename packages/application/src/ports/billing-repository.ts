import type { ProductSubscriptionStatus } from '@caredesk/domain';

export interface StoredPaymentMethod {
  providerSetupId: string;
  sealedToken: string;
  expiryMonth: number;
  expiryYear: number;
  last4: string;
}

export interface ProductSubscriptionRecord {
  tenantId: string;
  status: ProductSubscriptionStatus;
  priceAgorot: number;
  vatRateBps: number;
  launchDiscountPercent: number;
  chargingStartsAt: string | null;
  nextChargeOn: string | null;
  billingName: string | null;
  billingEmail: string | null;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  /**
   * Later of the two access-grace anchors (ISO date). Set when the customer
   * cancels and the stored card is removed, so the grace window runs from the
   * cancellation rather than from the long-past chargingStartsAt.
   */
  accessGraceStartsAt: string | null;
  /**
   * When a hosted card setup was last started and not yet completed. Recorded
   * separately from `status` so an abandoned checkout cannot stop billing for a
   * customer who already has a working card.
   */
  pendingSetupStartedAt: string | null;
  paymentMethod: StoredPaymentMethod | null;
}

export interface BillingSetupIntentRecord {
  intentId: string;
  tenantId: string;
  createdBy: string;
  billingName: string;
  billingEmail: string;
  termsVersion: string;
  termsAcceptedAt: string;
  providerSetupId: string | null;
  status: 'created' | 'pending' | 'completed' | 'failed';
}

export interface DueBillingCharge {
  chargeId: string;
  tenantId: string;
  billingPeriod: string;
  externalUniqId: string;
  amountAgorot: number;
  billingName: string;
  billingEmail: string;
  paymentMethod: StoredPaymentMethod;
}

export interface BillingDefaults {
  priceAgorot: number;
  vatRateBps: number;
  launchDiscountPercent: number;
  chargingStartsAt: string | null;
}

export interface BillingRepository {
  getOrCreate(tenantId: string, defaults: BillingDefaults): Promise<ProductSubscriptionRecord>;
  createSetupIntent(intent: BillingSetupIntentRecord): Promise<void>;
  attachProviderSetup(tenantId: string, intentId: string, providerSetupId: string): Promise<void>;
  findSetupIntentByProviderId(providerSetupId: string): Promise<BillingSetupIntentRecord | null>;
  completePaymentMethodSetup(
    tenantId: string,
    intentId: string,
    paymentMethod: StoredPaymentMethod,
  ): Promise<ProductSubscriptionRecord>;
  failPaymentMethodSetup(tenantId: string, intentId: string): Promise<void>;
  cancel(tenantId: string, cancelledAt: string): Promise<void>;
  claimDueCharges(now: string, limit: number): Promise<DueBillingCharge[]>;
  markChargeSucceeded(chargeId: string, providerTransactionId: string): Promise<void>;
  markChargeFailed(chargeId: string, failureCode: string): Promise<void>;
}

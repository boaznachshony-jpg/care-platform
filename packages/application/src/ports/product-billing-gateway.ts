export interface PaymentMethodSetupInput {
  intentId: string;
  billingName: string;
  billingEmail: string;
}

export interface PaymentMethodSetupSession {
  providerSetupId: string;
  checkoutUrl: string;
}

export interface VerifiedPaymentMethod {
  providerSetupId: string;
  returnValue: string;
  sealedToken: string;
  expiryMonth: number;
  expiryYear: number;
  last4: string;
}

export interface MonthlyChargeInput {
  externalUniqId: string;
  providerSetupId: string;
  amountAgorot: number;
  billingName: string;
  billingEmail: string;
  sealedToken: string;
  expiryMonth: number;
  expiryYear: number;
}

export interface MonthlyChargeResult {
  providerTransactionId: string;
}

export interface ProductBillingGateway {
  readonly configured: boolean;
  createPaymentMethodSetup(input: PaymentMethodSetupInput): Promise<PaymentMethodSetupSession>;
  verifyPaymentMethodSetup(providerSetupId: string): Promise<VerifiedPaymentMethod>;
  chargeMonthly(input: MonthlyChargeInput): Promise<MonthlyChargeResult>;
}

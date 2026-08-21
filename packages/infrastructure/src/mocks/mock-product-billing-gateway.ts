import type {
  MonthlyChargeInput,
  MonthlyChargeResult,
  PaymentMethodSetupInput,
  PaymentMethodSetupSession,
  ProductBillingGateway,
  VerifiedPaymentMethod,
} from '@caredesk/application';

export class MockProductBillingGateway implements ProductBillingGateway {
  readonly configured = true;
  readonly setups: PaymentMethodSetupInput[] = [];
  readonly charges: MonthlyChargeInput[] = [];

  async createPaymentMethodSetup(
    input: PaymentMethodSetupInput,
  ): Promise<PaymentMethodSetupSession> {
    this.setups.push(input);
    return {
      providerSetupId: '10000000-0000-4000-8000-000000000001',
      checkoutUrl: 'https://payments.example.test/setup',
    };
  }

  async verifyPaymentMethodSetup(providerSetupId: string): Promise<VerifiedPaymentMethod> {
    const setup = this.setups.at(-1);
    if (!setup) throw new Error('No setup exists.');
    return {
      providerSetupId,
      returnValue: setup.intentId,
      sealedToken: 'synthetic-sealed-token',
      expiryMonth: 12,
      expiryYear: 2030,
      last4: '4242',
    };
  }

  async chargeMonthly(input: MonthlyChargeInput): Promise<MonthlyChargeResult> {
    this.charges.push(input);
    // Deterministic decline hook for tests: a billing email whose local part
    // starts with "decline" simulates a synchronous provider refusal, the way
    // Cardcom rejects a real charge (CardcomGatewayError with a providerCode).
    if (input.billingEmail.toLowerCase().startsWith('decline')) {
      const error = new Error('Synthetic card decline.');
      error.name = 'MockCardDeclined';
      throw Object.assign(error, { providerCode: 'MOCK_DECLINED' });
    }
    return { providerTransactionId: `synthetic-${input.externalUniqId}` };
  }
}

export class DisabledProductBillingGateway implements ProductBillingGateway {
  readonly configured = false;
  async createPaymentMethodSetup(): Promise<never> {
    throw new Error('Billing provider is disabled.');
  }
  async verifyPaymentMethodSetup(): Promise<never> {
    throw new Error('Billing provider is disabled.');
  }
  async chargeMonthly(): Promise<never> {
    throw new Error('Billing provider is disabled.');
  }
}

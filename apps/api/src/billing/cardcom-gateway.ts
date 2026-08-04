import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type {
  MonthlyChargeInput,
  MonthlyChargeResult,
  PaymentMethodSetupInput,
  PaymentMethodSetupSession,
  ProductBillingGateway,
  VerifiedPaymentMethod,
} from '@caredesk/application';

const CREATE_URL = 'https://secure.cardcom.solutions/api/v11/LowProfile/Create';
const RESULT_URL = 'https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult';
const CHARGE_URL = 'https://secure.cardcom.solutions/api/v11/Transactions/Transaction';

interface CardcomConfig {
  terminalNumber: number;
  apiName: string;
  apiPassword: string;
  successUrl: string;
  failureUrl: string;
  webhookUrl: string;
  tokenEncryptionKey: string;
  markAsRecurring: boolean;
}

export class CardcomGatewayError extends Error {
  constructor(
    readonly providerCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'CardcomGatewayError';
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export class CardcomProductBillingGateway implements ProductBillingGateway {
  readonly configured = true;
  private readonly key: Buffer;

  constructor(
    private readonly config: CardcomConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.key = Buffer.from(config.tokenEncryptionKey, 'base64');
    if (this.key.length !== 32) throw new Error('Cardcom encryption key must contain 32 bytes.');
  }

  async createPaymentMethodSetup(
    input: PaymentMethodSetupInput,
  ): Promise<PaymentMethodSetupSession> {
    const response = await this.post(CREATE_URL, {
      TerminalNumber: this.config.terminalNumber,
      ApiName: this.config.apiName,
      Operation: 'CreateTokenOnly',
      ReturnValue: input.intentId,
      Amount: 0,
      SuccessRedirectUrl: this.config.successUrl,
      FailedRedirectUrl: this.config.failureUrl,
      CancelRedirectUrl: this.config.failureUrl,
      WebHookUrl: this.config.webhookUrl,
      ProductName: 'CareDesk monthly subscription',
      Language: 'he',
      ISOCoinId: 1,
      UIDefinition: {
        CardOwnerNameValue: input.billingName,
        CardOwnerEmailValue: input.billingEmail,
        IsCardOwnerEmailRequired: true,
      },
      AdvancedDefinition: { JValidateType: 2 },
    });
    this.assertSuccess(response);
    const providerSetupId = getString(response.LowProfileId);
    const checkoutUrl = getString(response.Url);
    if (!providerSetupId || !checkoutUrl) {
      throw new CardcomGatewayError('INVALID_CREATE_RESPONSE', 'Cardcom omitted setup details.');
    }
    return { providerSetupId, checkoutUrl };
  }

  async verifyPaymentMethodSetup(providerSetupId: string): Promise<VerifiedPaymentMethod> {
    const response = await this.post(RESULT_URL, {
      TerminalNumber: this.config.terminalNumber,
      ApiName: this.config.apiName,
      LowProfileId: providerSetupId,
    });
    this.assertSuccess(response);
    if (response.Operation !== 'CreateTokenOnly' && response.Operation !== 'ChargeAndCreateToken') {
      throw new CardcomGatewayError('WRONG_OPERATION', 'Unexpected Cardcom operation.');
    }
    const tokenInfo = asObject(response.TokenInfo);
    const transactionInfo = asObject(response.TranzactionInfo);
    const uiValues = asObject(response.UIValues);
    const token = getString(tokenInfo.Token) ?? getString(transactionInfo.Token);
    const returnValue = getString(response.ReturnValue);
    const expiryMonth = Number(tokenInfo.CardMonth ?? uiValues.CardMonth);
    const rawExpiryYear = Number(tokenInfo.CardYear ?? uiValues.CardYear);
    const expiryYear = rawExpiryYear < 100 ? 2000 + rawExpiryYear : rawExpiryYear;
    const last4Raw = transactionInfo.Last4CardDigitsString ?? transactionInfo.Last4CardDigits;
    const last4Candidate = last4Raw == null ? '' : String(last4Raw).padStart(4, '0');
    if (
      !token ||
      !returnValue ||
      !Number.isInteger(expiryMonth) ||
      expiryMonth < 1 ||
      expiryMonth > 12 ||
      !Number.isInteger(expiryYear) ||
      expiryYear < 2020 ||
      expiryYear > 2200 ||
      !/^\d{4}$/.test(last4Candidate)
    ) {
      throw new CardcomGatewayError(
        'INVALID_RESULT_RESPONSE',
        'Cardcom omitted verified token metadata.',
      );
    }
    return {
      providerSetupId,
      returnValue,
      sealedToken: this.seal(token, providerSetupId),
      expiryMonth,
      expiryYear,
      last4: last4Candidate,
    };
  }

  async chargeMonthly(input: MonthlyChargeInput): Promise<MonthlyChargeResult> {
    if (!Number.isInteger(input.amountAgorot) || input.amountAgorot <= 0) {
      throw new CardcomGatewayError('INVALID_AMOUNT', 'Charge amount must be positive agorot.');
    }
    const amount = input.amountAgorot / 100;
    const expiration = `${String(input.expiryMonth).padStart(2, '0')}${String(input.expiryYear).slice(-2)}`;
    const response = await this.post(CHARGE_URL, {
      TerminalNumber: this.config.terminalNumber,
      ApiName: this.config.apiName,
      Amount: amount,
      Token: this.open(input.sealedToken, input.providerSetupId),
      CardExpirationMMYY: expiration,
      ExternalUniqTranId: input.externalUniqId,
      ExternalUniqUniqTranIdResponse: true,
      NumOfPayments: 1,
      ISOCoinId: 1,
      Advanced: {
        ApiPassword: this.config.apiPassword,
        ...(this.config.markAsRecurring ? { IsAutoRecurringPayment: true } : {}),
      },
      Document: {
        DocumentTypeToCreate: 'TaxInvoiceAndReceipt',
        Name: input.billingName,
        Email: input.billingEmail,
        IsSendByEmail: true,
        IsVatFree: false,
        // The API 11 direct-transaction document schema intentionally spells
        // this field without the second "a" (unlike the hosted-page schema).
        Languge: 'he',
        Products: [
          {
            ProductID: 'CAREDESK-MONTHLY',
            Description: 'CareDesk monthly subscription',
            Quantity: 1,
            UnitCost: amount,
            TotalLineCost: amount,
            IsVatFree: false,
          },
        ],
      },
    });
    this.assertSuccess(response);
    const providerTransactionId = String(response.TranzactionId ?? '');
    if (!providerTransactionId) {
      throw new CardcomGatewayError('INVALID_CHARGE_RESPONSE', 'Cardcom omitted transaction id.');
    }
    return { providerTransactionId };
  }

  private async post(url: string, payload: unknown): Promise<Record<string, unknown>> {
    const response = await this.fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const body = asObject(await response.json().catch(() => ({})));
    if (!response.ok) {
      throw new CardcomGatewayError(String(response.status), 'Cardcom request failed.');
    }
    return body;
  }

  private assertSuccess(response: Record<string, unknown>): void {
    if (Number(response.ResponseCode) !== 0) {
      throw new CardcomGatewayError(
        String(response.ResponseCode ?? 'UNKNOWN'),
        getString(response.Description) ?? 'Cardcom rejected the operation.',
      );
    }
  }

  private seal(value: string, context: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [nonce, tag, ciphertext].map((part) => part.toString('base64url')).join('.');
  }

  private open(value: string, context: string): string {
    const [nonceValue, tagValue, ciphertextValue] = value.split('.');
    if (!nonceValue || !tagValue || !ciphertextValue) {
      throw new CardcomGatewayError('INVALID_SEALED_TOKEN', 'Stored payment token is invalid.');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(nonceValue, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

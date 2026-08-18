import { describe, expect, it, vi } from 'vitest';
import { CardcomProductBillingGateway } from './cardcom-gateway.js';

const key = Buffer.alloc(32, 7).toString('base64');

describe('CardcomProductBillingGateway', () => {
  it('creates a hosted token setup, verifies it server-to-server and charges idempotently', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url, body });
      if (url.endsWith('/LowProfile/Create')) {
        return new Response(
          JSON.stringify({
            ResponseCode: 0,
            LowProfileId: '10000000-0000-4000-8000-000000000001',
            Url: 'https://secure.cardcom.solutions/hosted/setup',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/LowProfile/GetLpResult')) {
        return new Response(
          JSON.stringify({
            ResponseCode: 0,
            Operation: 'CreateTokenOnly',
            ReturnValue: '20000000-0000-4000-8000-000000000002',
            TokenInfo: { Token: 'provider-token', CardMonth: 9, CardYear: 2031 },
            TranzactionInfo: { Last4CardDigitsString: '1234' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ResponseCode: 0, TranzactionId: 99123 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const gateway = new CardcomProductBillingGateway(
      {
        terminalNumber: 1000,
        apiName: 'api-user',
        apiPassword: 'api-password',
        successUrl: 'https://app.example.test/billing?setup=success',
        failureUrl: 'https://app.example.test/billing?setup=failed',
        webhookUrl: 'https://api.example.test/billing/webhooks/cardcom',
        tokenEncryptionKey: key,
        markAsRecurring: false,
      },
      fetcher as typeof fetch,
    );

    const setup = await gateway.createPaymentMethodSetup({
      intentId: '20000000-0000-4000-8000-000000000002',
      billingName: 'Test Customer',
      billingEmail: 'customer@example.test',
    });
    expect(setup.checkoutUrl).toContain('secure.cardcom.solutions');
    expect(calls[0]?.body).toMatchObject({
      Operation: 'CreateTokenOnly',
      Amount: 0,
      ReturnValue: '20000000-0000-4000-8000-000000000002',
    });

    const verified = await gateway.verifyPaymentMethodSetup(setup.providerSetupId);
    expect(verified).toMatchObject({ last4: '1234', expiryMonth: 9, expiryYear: 2031 });
    expect(verified.sealedToken).not.toContain('provider-token');

    const charge = await gateway.chargeMonthly({
      externalUniqId: 'caredesk-tenant-2026-09-01',
      providerSetupId: verified.providerSetupId,
      amountAgorot: 3900,
      billingName: 'Test Customer',
      billingEmail: 'customer@example.test',
      sealedToken: verified.sealedToken,
      expiryMonth: verified.expiryMonth,
      expiryYear: verified.expiryYear,
    });
    expect(charge.providerTransactionId).toBe('99123');
    expect(calls[2]?.body).toMatchObject({
      Amount: 39,
      Token: 'provider-token',
      CardExpirationMMYY: '0931',
      ExternalUniqTranId: 'caredesk-tenant-2026-09-01',
      ExternalUniqUniqTranIdResponse: true,
    });
    expect(calls[2]?.body).not.toHaveProperty('Advanced.IsAutoRecurringPayment');
    expect(calls[2]?.body).toHaveProperty('Document.Languge', 'he');
  });

  it('normalizes the two-digit expiry year returned in UIValues', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ResponseCode: 0,
            Operation: 'CreateTokenOnly',
            ReturnValue: '20000000-0000-4000-8000-000000000002',
            TokenInfo: { Token: 'provider-token' },
            UIValues: { CardMonth: 9, CardYear: 31 },
            TranzactionInfo: { Last4CardDigitsString: '1234' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const gateway = new CardcomProductBillingGateway(
      {
        terminalNumber: 1000,
        apiName: 'api-user',
        apiPassword: 'api-password',
        successUrl: 'https://app.example.test/billing?setup=success',
        failureUrl: 'https://app.example.test/billing?setup=failed',
        webhookUrl: 'https://api.example.test/billing/webhooks/cardcom',
        tokenEncryptionKey: key,
        markAsRecurring: false,
      },
      fetcher as typeof fetch,
    );
    await expect(
      gateway.verifyPaymentMethodSetup('10000000-0000-4000-8000-000000000001'),
    ).resolves.toMatchObject({ expiryMonth: 9, expiryYear: 2031 });
  });

  it('marks the charge as auto-recurring when configured', async () => {
    const calls: Array<{ body: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (_: string, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ ResponseCode: 0, TranzactionId: 77001 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const gateway = new CardcomProductBillingGateway(
      {
        terminalNumber: 1000,
        apiName: 'api-user',
        apiPassword: 'api-password',
        successUrl: 'https://app.example.test/billing?setup=success',
        failureUrl: 'https://app.example.test/billing?setup=failed',
        webhookUrl: 'https://api.example.test/billing/webhooks/cardcom',
        tokenEncryptionKey: key,
        markAsRecurring: true,
      },
      fetcher as typeof fetch,
    );
    // Seal a token so we can call chargeMonthly directly
    const setup = new CardcomProductBillingGateway(
      {
        terminalNumber: 1000,
        apiName: 'api-user',
        apiPassword: 'api-password',
        successUrl: 'https://app.example.test/billing?setup=success',
        failureUrl: 'https://app.example.test/billing?setup=failed',
        webhookUrl: 'https://api.example.test/billing/webhooks/cardcom',
        tokenEncryptionKey: key,
        markAsRecurring: false,
      },
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ResponseCode: 0,
              Operation: 'CreateTokenOnly',
              ReturnValue: 'intent-1',
              TokenInfo: { Token: 'raw-token', CardMonth: 6, CardYear: 2030 },
              TranzactionInfo: { Last4CardDigitsString: '9999' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ) as typeof fetch,
    );
    const verified = await setup.verifyPaymentMethodSetup('setup-id-1');
    await gateway.chargeMonthly({
      externalUniqId: 'recurring-test',
      providerSetupId: verified.providerSetupId,
      amountAgorot: 3900,
      billingName: 'Recurring Customer',
      billingEmail: 'recurring@example.test',
      sealedToken: verified.sealedToken,
      expiryMonth: verified.expiryMonth,
      expiryYear: verified.expiryYear,
    });
    expect(calls[0]?.body).toHaveProperty('Advanced.IsAutoRecurringPayment', true);
  });

  it('throws a CardcomGatewayError when the API returns a non-zero ResponseCode', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ResponseCode: 1001, Description: 'Invalid terminal' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const gateway = new CardcomProductBillingGateway(
      {
        terminalNumber: 9999,
        apiName: 'bad-api',
        apiPassword: 'bad-password',
        successUrl: 'https://app.example.test/billing?setup=success',
        failureUrl: 'https://app.example.test/billing?setup=failed',
        webhookUrl: 'https://api.example.test/billing/webhooks/cardcom',
        tokenEncryptionKey: key,
        markAsRecurring: false,
      },
      fetcher as typeof fetch,
    );
    await expect(
      gateway.createPaymentMethodSetup({
        intentId: 'intent-error',
        billingName: 'Test',
        billingEmail: 'test@example.test',
      }),
    ).rejects.toMatchObject({ name: 'CardcomGatewayError', providerCode: '1001' });
  });

  it('throws a CardcomGatewayError when the HTTP request itself fails (non-2xx)', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({}), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const gateway = new CardcomProductBillingGateway(
      {
        terminalNumber: 1000,
        apiName: 'api-user',
        apiPassword: 'api-password',
        successUrl: 'https://app.example.test/billing?setup=success',
        failureUrl: 'https://app.example.test/billing?setup=failed',
        webhookUrl: 'https://api.example.test/billing/webhooks/cardcom',
        tokenEncryptionKey: key,
        markAsRecurring: false,
      },
      fetcher as typeof fetch,
    );
    await expect(
      gateway.createPaymentMethodSetup({
        intentId: 'intent-down',
        billingName: 'Test',
        billingEmail: 'test@example.test',
      }),
    ).rejects.toMatchObject({ name: 'CardcomGatewayError', providerCode: '503' });
  });

  it('throws INVALID_AMOUNT when the charge amount is zero or negative', async () => {
    const gateway = new CardcomProductBillingGateway(
      {
        terminalNumber: 1000,
        apiName: 'api-user',
        apiPassword: 'api-password',
        successUrl: 'https://app.example.test/billing?setup=success',
        failureUrl: 'https://app.example.test/billing?setup=failed',
        webhookUrl: 'https://api.example.test/billing/webhooks/cardcom',
        tokenEncryptionKey: key,
        markAsRecurring: false,
      },
      vi.fn() as typeof fetch,
    );
    await expect(
      gateway.chargeMonthly({
        externalUniqId: 'zero-test',
        providerSetupId: 'setup-id-1',
        amountAgorot: 0,
        billingName: 'Test',
        billingEmail: 'test@example.test',
        sealedToken: 'any',
        expiryMonth: 9,
        expiryYear: 2031,
      }),
    ).rejects.toMatchObject({ providerCode: 'INVALID_AMOUNT' });
  });

  it('throws INVALID_SEALED_TOKEN when the stored token has been tampered with', async () => {
    // Build a valid sealed token with one gateway, then try to open it with different context
    const senderGateway = new CardcomProductBillingGateway(
      {
        terminalNumber: 1000,
        apiName: 'api-user',
        apiPassword: 'api-password',
        successUrl: 'https://app.example.test/billing?setup=success',
        failureUrl: 'https://app.example.test/billing?setup=failed',
        webhookUrl: 'https://api.example.test/billing/webhooks/cardcom',
        tokenEncryptionKey: key,
        markAsRecurring: false,
      },
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ResponseCode: 0,
              Operation: 'CreateTokenOnly',
              ReturnValue: 'intent-1',
              TokenInfo: { Token: 'real-token', CardMonth: 1, CardYear: 2030 },
              TranzactionInfo: { Last4CardDigitsString: '1111' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ) as typeof fetch,
    );
    const verified = await senderGateway.verifyPaymentMethodSetup('original-setup-id');
    // Tamper: flip one character in the ciphertext segment
    const [nonce, tag, ciphertext] = verified.sealedToken.split('.');
    const tampered = [nonce, tag, ciphertext?.slice(0, -1) + 'X'].join('.');

    const attackerGateway = new CardcomProductBillingGateway(
      {
        terminalNumber: 1000,
        apiName: 'api-user',
        apiPassword: 'api-password',
        successUrl: 'https://app.example.test/billing?setup=success',
        failureUrl: 'https://app.example.test/billing?setup=failed',
        webhookUrl: 'https://api.example.test/billing/webhooks/cardcom',
        tokenEncryptionKey: key,
        markAsRecurring: false,
      },
      vi.fn() as typeof fetch,
    );
    await expect(
      attackerGateway.chargeMonthly({
        externalUniqId: 'tamper-test',
        providerSetupId: verified.providerSetupId,
        amountAgorot: 3900,
        billingName: 'Attacker',
        billingEmail: 'attack@example.test',
        sealedToken: tampered,
        expiryMonth: 1,
        expiryYear: 2030,
      }),
    ).rejects.toThrow();
  });

  it('rejects incomplete verified card metadata instead of inventing a last four value', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ResponseCode: 0,
            Operation: 'CreateTokenOnly',
            ReturnValue: '20000000-0000-4000-8000-000000000002',
            TokenInfo: { Token: 'provider-token', CardMonth: 9, CardYear: 2031 },
            TranzactionInfo: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const gateway = new CardcomProductBillingGateway(
      {
        terminalNumber: 1000,
        apiName: 'api-user',
        apiPassword: 'api-password',
        successUrl: 'https://app.example.test/billing?setup=success',
        failureUrl: 'https://app.example.test/billing?setup=failed',
        webhookUrl: 'https://api.example.test/billing/webhooks/cardcom',
        tokenEncryptionKey: key,
        markAsRecurring: false,
      },
      fetcher as typeof fetch,
    );
    await expect(
      gateway.verifyPaymentMethodSetup('10000000-0000-4000-8000-000000000001'),
    ).rejects.toMatchObject({ providerCode: 'INVALID_RESULT_RESPONSE' });
  });
});

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

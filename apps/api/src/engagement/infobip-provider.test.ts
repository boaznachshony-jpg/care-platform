import { describe, expect, it, vi } from 'vitest';
import { InfobipSmsProvider, InfobipWhatsAppProvider } from './infobip-provider.js';

const baseConfig = {
  apiKey: 'server-only-infobip-key',
  baseUrl: 'https://example.api.infobip.com',
  sender: 'CareDesk',
  deliveryWebhookUrl: 'https://api.example.test/webhooks/infobip/delivery',
};

describe('Infobip communication providers', () => {
  it('fails closed when required configuration is missing', async () => {
    await expect(new InfobipSmsProvider({}).send({ to: '972500000000', text: 'Synthetic' })).resolves.toMatchObject({
      status: 'failed',
      provider: 'infobip',
      failureCategory: 'configuration',
    });
  });

  it('sends WhatsApp through Messages API with delivery webhook', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ messageId: 'wa-1' }] }),
    });
    const result = await new InfobipWhatsAppProvider(baseConfig, request).send({
      to: '972500000000',
      text: 'Synthetic utility notice',
    });

    expect(result).toEqual({ status: 'accepted', provider: 'infobip', providerMessageId: 'wa-1' });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]![0]).toBe('https://example.api.infobip.com/messages-api/1/messages');
    const init = request.mock.calls[0]![1]!;
    expect(init.headers.authorization).toBe('App server-only-infobip-key');
    const payload = JSON.parse(init.body as string);
    expect(payload.messages[0]).toMatchObject({
      channel: 'WHATSAPP',
      sender: 'CareDesk',
      destinations: [{ to: '972500000000' }],
      content: { body: { text: 'Synthetic utility notice', type: 'TEXT' } },
      webhooks: { delivery: { url: 'https://api.example.test/webhooks/infobip/delivery' } },
    });
  });

  it('sends SMS through the same Messages API boundary', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messageId: 'sms-1' }) });
    await expect(
      new InfobipSmsProvider({ ...baseConfig, sender: 'CareDesk' }, request).send({
        to: '972500000000',
        text: 'Synthetic SMS',
      }),
    ).resolves.toEqual({ status: 'accepted', provider: 'infobip', providerMessageId: 'sms-1' });
    const payload = JSON.parse(request.mock.calls[0]![1]!.body as string);
    expect(payload.messages[0].channel).toBe('SMS');
  });

  it('classifies provider rejection and transport failure', async () => {
    const rejected = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(
      new InfobipSmsProvider(baseConfig, rejected).send({ to: '972500000000', text: 'Synthetic' }),
    ).resolves.toMatchObject({ status: 'failed', failureCategory: 'provider_rejected' });

    const failed = vi.fn().mockRejectedValue(new Error('network'));
    await expect(
      new InfobipSmsProvider(baseConfig, failed).send({ to: '972500000000', text: 'Synthetic' }),
    ).resolves.toMatchObject({ status: 'failed', failureCategory: 'timeout' });
  });

  it('never exposes the API key in the delivery result', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messageId: 'm-1' }) });
    const result = await new InfobipSmsProvider(baseConfig, request).send({
      to: '972500000000',
      text: 'Synthetic',
    });
    expect(JSON.stringify(result)).not.toContain(baseConfig.apiKey);
  });
});

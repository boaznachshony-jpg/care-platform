import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../create-server.js';
import { loadEnv } from '../env.js';

const configuredEnv = loadEnv({
  SUPPORT_DESTINATION_EMAIL: 'private-destination@example.com',
  SUPPORT_FROM_EMAIL: 'support@example.com',
  RESEND_API_KEY: 'server-only-resend-key',
});

describe('support request routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('delivers a short request without exposing the destination in its response', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const app = buildServer(configuredEnv);

    const response = await app.inject({
      method: 'POST',
      url: '/support/requests',
      payload: {
        kind: 'help',
        replyEmail: 'customer@example.com',
        message: 'לא הצלחתי לשמור את המשימה החדשה.',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: true });
    expect(response.body).not.toContain('private-destination@example.com');
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      to: ['private-destination@example.com'],
      reply_to: 'customer@example.com',
    });
    await app.close();
  });

  it('rejects an invalid email, a message that is too short, and an oversized message', async () => {
    const app = buildServer(configuredEnv);

    for (const payload of [
      { kind: 'help', replyEmail: 'not-an-email', message: 'הודעה מספיק ארוכה' },
      { kind: 'help', replyEmail: 'valid@example.com', message: 'קצר' },
      { kind: 'feedback', replyEmail: 'valid@example.com', message: 'א'.repeat(501) },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/support/requests', payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    await app.close();
  });

  it('silently accepts the honeypot without contacting the provider', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const app = buildServer(configuredEnv);

    const response = await app.inject({
      method: 'POST',
      url: '/support/requests',
      payload: {
        kind: 'feedback',
        replyEmail: 'bot@example.com',
        message: 'This looks like a normal message.',
        website: 'https://spam.example.com',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('fails closed when the server-only delivery settings are absent', async () => {
    const app = buildServer(loadEnv({}));
    const response = await app.inject({
      method: 'POST',
      url: '/support/requests',
      payload: {
        kind: 'help',
        replyEmail: 'customer@example.com',
        message: 'בקשת עזרה תקינה ומפורטת.',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'SUPPORT_NOT_CONFIGURED' });
    await app.close();
  });

  it('rate limits through the provider contract and sends retry guidance', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 })),
    );
    const app = buildServer(configuredEnv);
    const request = {
      method: 'POST' as const,
      url: '/support/requests',
      payload: {
        kind: 'help',
        replyEmail: 'customer@example.com',
        message: 'A sufficiently detailed support request.',
      },
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await app.inject(request)).statusCode).toBe(202);
    }
    const limited = await app.inject(request);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: 'SUPPORT_RATE_LIMITED' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    await app.close();
  });
});

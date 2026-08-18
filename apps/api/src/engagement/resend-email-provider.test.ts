import { describe, expect, it, vi } from 'vitest';
import { ResendEmailProvider } from './resend-email-provider.js';

describe('ResendEmailProvider', () => {
  const email = {
    to: 'recipient@example.test',
    subject: 'Synthetic notice',
    text: 'Sign in to view the record.',
  };
  it('fails safely when server configuration is missing', async () => {
    await expect(new ResendEmailProvider({}).send(email)).resolves.toMatchObject({
      status: 'failed',
      failureCategory: 'configuration',
    });
  });
  it('returns provider evidence without exposing credentials or message bodies', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ id: 'provider-1' }) });
    const result = await new ResendEmailProvider(
      { apiKey: 'server-only-key', fromEmail: 'support@example.test' },
      request,
    ).send(email);
    expect(result).toEqual({
      status: 'accepted',
      provider: 'resend',
      providerMessageId: 'provider-1',
    });
    expect(JSON.stringify(result)).not.toContain('server-only-key');
  });
  it('classifies provider timeouts', async () => {
    const request = vi.fn().mockRejectedValue(new Error('timeout'));
    await expect(
      new ResendEmailProvider(
        { apiKey: 'server-only-key', fromEmail: 'support@example.test' },
        request,
      ).send(email),
    ).resolves.toMatchObject({ status: 'failed', failureCategory: 'timeout' });
  });

  it('accepts a successful response with malformed provider JSON without duplicate retries', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('malformed JSON');
      },
    });
    await expect(
      new ResendEmailProvider(
        { apiKey: 'server-only-key', fromEmail: 'support@example.test' },
        request,
      ).send(email),
    ).resolves.toEqual({ status: 'accepted', provider: 'resend' });
  });

  it('ignores an invalid provider message id', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 123 }) });
    await expect(
      new ResendEmailProvider(
        { apiKey: 'server-only-key', fromEmail: 'support@example.test' },
        request,
      ).send(email),
    ).resolves.toEqual({ status: 'accepted', provider: 'resend' });
  });

  // ── Resend integration edge cases ─────────────────────────────────────────

  // The implementation checks response.ok only; 4xx/5xx all become provider_rejected.
  it.each([400, 422, 429, 500])(
    'classifies HTTP %i response (ok=false) as provider_rejected',
    async () => {
      const request = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
      await expect(
        new ResendEmailProvider(
          { apiKey: 'server-only-key', fromEmail: 'support@example.test' },
          request,
        ).send(email),
      ).resolves.toMatchObject({ status: 'failed', failureCategory: 'provider_rejected' });
    },
  );

  it('forwards html and replyTo fields in the Resend request body', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ id: 'provider-2' }) });
    await new ResendEmailProvider(
      { apiKey: 'server-only-key', fromEmail: 'support@example.test' },
      request,
    ).send({
      to: 'recipient@example.test',
      subject: 'Synthetic notice',
      text: 'Plain text fallback.',
      html: '<p>HTML body</p>',
      replyTo: 'noreply@example.test',
    });
    const body = JSON.parse(request.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(body.html).toBe('<p>HTML body</p>');
    expect(body.reply_to).toBe('noreply@example.test');
  });

  it('omits html and reply_to keys when not provided', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ id: 'provider-3' }) });
    await new ResendEmailProvider(
      { apiKey: 'server-only-key', fromEmail: 'support@example.test' },
      request,
    ).send(email);
    const body = JSON.parse(request.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty('html');
    expect(body).not.toHaveProperty('reply_to');
  });
});

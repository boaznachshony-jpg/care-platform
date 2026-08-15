export interface TransactionalEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export interface EmailDeliveryResult {
  status: 'accepted' | 'failed';
  provider: 'resend';
  providerMessageId?: string;
  failureCategory?: 'configuration' | 'timeout' | 'provider_rejected';
}

/** The single server-only Resend boundary for product and support email. */
export class ResendEmailProvider {
  constructor(
    private readonly config: { apiKey?: string; fromEmail?: string },
    private readonly request: typeof fetch = fetch,
  ) {}

  async send(message: TransactionalEmail): Promise<EmailDeliveryResult> {
    if (!this.config.apiKey || !this.config.fromEmail) {
      return { status: 'failed', provider: 'resend', failureCategory: 'configuration' };
    }
    try {
      const response = await this.request('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: `CareDesk <${this.config.fromEmail}>`,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
      });
      if (!response.ok)
        return { status: 'failed', provider: 'resend', failureCategory: 'provider_rejected' };
      const body = (await response.json()) as { id?: string };
      return {
        status: 'accepted',
        provider: 'resend',
        ...(body.id ? { providerMessageId: body.id } : {}),
      };
    } catch {
      return { status: 'failed', provider: 'resend', failureCategory: 'timeout' };
    }
  }
}

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

interface HttpResponse {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export type HttpRequest = (input: string, init?: HttpRequestInit) => Promise<HttpResponse>;

// Node provides fetch at runtime. Keep the DOM's much broader Request/Response
// model out of this server project and expose only what the adapter consumes.
const nodeHttpRequest: HttpRequest = (input, init) =>
  (globalThis.fetch as unknown as HttpRequest)(input, init);

function providerMessageId(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('id' in body)) return undefined;
  const id = (body as { id?: unknown }).id;
  return typeof id === 'string' && id.trim().length > 0 ? id : undefined;
}

/** The single server-only Resend boundary for product and support email. */
export class ResendEmailProvider {
  constructor(
    private readonly config: { apiKey?: string; fromEmail?: string },
    private readonly request: HttpRequest = nodeHttpRequest,
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
      let messageId: string | undefined;
      try {
        messageId = providerMessageId(await response.json());
      } catch {
        // Resend accepted the request. Malformed/non-JSON evidence must not turn
        // a successful delivery request into a retry and duplicate email.
      }
      return {
        status: 'accepted',
        provider: 'resend',
        ...(messageId ? { providerMessageId: messageId } : {}),
      };
    } catch {
      return { status: 'failed', provider: 'resend', failureCategory: 'timeout' };
    }
  }
}

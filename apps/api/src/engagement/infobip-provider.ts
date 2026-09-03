import type { CommunicationProvider, DeliveryResult } from '@caredesk/application';

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

const nodeHttpRequest: HttpRequest = (input, init) =>
  (globalThis.fetch as unknown as HttpRequest)(input, init);

type InfobipChannel = 'WHATSAPP' | 'SMS';

type ProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  sender?: string;
  deliveryWebhookUrl?: string;
};

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function parseMessageId(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const root = body as Record<string, unknown>;
  const direct = root.messageId;
  if (typeof direct === 'string' && direct.trim()) return direct;
  const messages = root.messages;
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  const first = messages[0];
  if (typeof first !== 'object' || first === null) return undefined;
  const id = (first as Record<string, unknown>).messageId;
  return typeof id === 'string' && id.trim() ? id : undefined;
}

abstract class InfobipProvider implements CommunicationProvider {
  abstract readonly channel: 'whatsapp' | 'sms';
  readonly name = 'infobip';

  protected constructor(
    private readonly providerChannel: InfobipChannel,
    private readonly config: ProviderConfig,
    private readonly request: HttpRequest = nodeHttpRequest,
  ) {}

  async send(message: { to: string; subject?: string; text: string; html?: string }): Promise<DeliveryResult> {
    if (!this.config.apiKey || !this.config.baseUrl || !this.config.sender) {
      return { status: 'failed', provider: this.name, failureCategory: 'configuration' };
    }

    const payload = {
      messages: [
        {
          channel: this.providerChannel,
          sender: this.config.sender,
          destinations: [{ to: message.to }],
          content: { body: { text: message.text, type: 'TEXT' } },
          ...(this.config.deliveryWebhookUrl
            ? { webhooks: { delivery: { url: this.config.deliveryWebhookUrl } } }
            : {}),
        },
      ],
    };

    try {
      const response = await this.request(`${normalizeBaseUrl(this.config.baseUrl)}/messages-api/1/messages`, {
        method: 'POST',
        headers: {
          authorization: `App ${this.config.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        return { status: 'failed', provider: this.name, failureCategory: 'provider_rejected' };
      }

      let providerMessageId: string | undefined;
      try {
        providerMessageId = parseMessageId(await response.json());
      } catch {
        // Accepted by Infobip. Do not retry solely because response evidence was malformed.
      }

      return {
        status: 'accepted',
        provider: this.name,
        ...(providerMessageId ? { providerMessageId } : {}),
      };
    } catch {
      return { status: 'failed', provider: this.name, failureCategory: 'timeout' };
    }
  }
}

export class InfobipWhatsAppProvider extends InfobipProvider {
  readonly channel = 'whatsapp' as const;
  constructor(config: ProviderConfig, request?: HttpRequest) {
    super('WHATSAPP', config, request);
  }
}

export class InfobipSmsProvider extends InfobipProvider {
  readonly channel = 'sms' as const;
  constructor(config: ProviderConfig, request?: HttpRequest) {
    super('SMS', config, request);
  }
}

export type CommunicationChannel = 'email' | 'whatsapp' | 'sms';
export type ConsentState = 'unknown' | 'granted' | 'revoked';
export type SupportedLocale = 'he' | 'en';

export interface CommunicationPreference {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  smsEnabled: boolean;
  preferredChannel: CommunicationChannel;
  preferredLocale: SupportedLocale;
  whatsappConsent: ConsentState;
  smsConsent: ConsentState;
}

export interface NotificationIntent {
  id: string;
  tenantId: string;
  recipientId: string;
  templateKey: string;
  templateVersion: number;
  idempotencyKey: string;
  authenticatedPath: string;
}

export interface DeliveryResult {
  status: 'accepted' | 'failed' | 'disabled';
  provider?: string;
  providerMessageId?: string;
  failureCategory?: 'configuration' | 'timeout' | 'provider_rejected';
}

export interface CommunicationProvider {
  readonly channel: CommunicationChannel;
  readonly name: string;
  send(message: {
    to: string;
    subject?: string;
    text: string;
    html?: string;
  }): Promise<DeliveryResult>;
}

export function eligibleChannels(preference: CommunicationPreference): CommunicationChannel[] {
  const channels: CommunicationChannel[] = [];
  if (preference.emailEnabled) channels.push('email');
  if (preference.whatsappEnabled && preference.whatsappConsent === 'granted') {
    channels.push('whatsapp');
  }
  if (preference.smsEnabled && preference.smsConsent === 'granted') channels.push('sms');
  return channels.sort((a) => (a === preference.preferredChannel ? -1 : 1));
}

/** Explicitly disabled adapter: callers can never mistake unconfigured channels for delivery. */
export class DisabledCommunicationProvider implements CommunicationProvider {
  readonly name = 'unconfigured';
  constructor(readonly channel: 'whatsapp' | 'sms') {}
  async send(): Promise<DeliveryResult> {
    return { status: 'disabled', failureCategory: 'configuration' };
  }
}

export class NotificationOrchestrator {
  private readonly completed = new Map<string, DeliveryResult>();
  constructor(private readonly providers: readonly CommunicationProvider[]) {}

  async deliver(input: {
    intent: NotificationIntent;
    destinationByChannel: Partial<Record<CommunicationChannel, string>>;
    preference: CommunicationPreference;
    render: (
      locale: SupportedLocale,
      authenticatedPath: string,
    ) => {
      subject?: string;
      text: string;
      html?: string;
    };
  }): Promise<DeliveryResult> {
    const previous = this.completed.get(input.intent.idempotencyKey);
    if (previous) return previous;
    for (const channel of eligibleChannels(input.preference)) {
      const provider = this.providers.find((candidate) => candidate.channel === channel);
      const to = input.destinationByChannel[channel];
      if (!provider || !to) continue;
      const result = await provider.send({
        to,
        ...input.render(input.preference.preferredLocale, input.intent.authenticatedPath),
      });
      if (result.status === 'accepted') {
        this.completed.set(input.intent.idempotencyKey, result);
        return result;
      }
    }
    return { status: 'failed', failureCategory: 'configuration' };
  }
}

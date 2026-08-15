import { describe, expect, it, vi } from 'vitest';
import {
  DisabledCommunicationProvider,
  eligibleChannels,
  NotificationOrchestrator,
  type CommunicationProvider,
} from './engagement.js';

const preference = {
  emailEnabled: true,
  whatsappEnabled: true,
  smsEnabled: true,
  preferredChannel: 'whatsapp' as const,
  preferredLocale: 'he' as const,
  whatsappConsent: 'unknown' as const,
  smsConsent: 'revoked' as const,
};

describe('engagement orchestration', () => {
  it('requires affirmative phone-channel consent', () => {
    expect(eligibleChannels(preference)).toEqual(['email']);
  });

  it('reports unconfigured WhatsApp honestly', async () => {
    await expect(new DisabledCommunicationProvider('whatsapp').send()).resolves.toEqual({
      status: 'disabled',
      failureCategory: 'configuration',
    });
  });

  it('delivers idempotently and renders the recipient language with an authenticated path', async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ status: 'accepted', provider: 'test', providerMessageId: 'msg-1' });
    const provider: CommunicationProvider = { channel: 'email', name: 'test', send };
    const orchestrator = new NotificationOrchestrator([provider]);
    const input = {
      intent: {
        id: 'intent-1',
        tenantId: 'tenant-a',
        recipientId: 'member-a',
        templateKey: 'task_assigned',
        templateVersion: 1,
        idempotencyKey: 'task-a:assigned:member-a',
        authenticatedPath: '/app/tasks/task-a',
      },
      destinationByChannel: { email: 'synthetic@example.test' },
      preference,
      render: (locale: 'he' | 'en', path: string) => ({ subject: locale, text: `Open ${path}` }),
    };
    await orchestrator.deliver(input);
    await orchestrator.deliver(input);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'he',
        text: expect.stringContaining('/app/tasks/task-a'),
      }),
    );
  });
});

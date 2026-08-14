import { describe, expect, it, vi } from 'vitest';
import { AuthorizationError } from '@caredesk/application';
import { buildContainer, DEV_TOKEN } from '../container.js';
import { buildServer } from '../create-server.js';
import { loadEnv } from '../env.js';

const id = (suffix: string) => `00000000-0000-4000-8000-0000000000${suffix}`;
const headers = { authorization: `Bearer ${DEV_TOKEN}`, 'idempotency-key': 'tenant-replay-key' };

describe('visa renewal mutation routes', () => {
  it('maps authorization denial to 403 for every remaining tenant-scoped command', async () => {
    const container = buildContainer(loadEnv({}));
    for (const command of [
      container.recordVisaRenewalContact,
      container.linkRenewedVisaAuthorization,
      container.resolveVisaAuthorizationOverlap,
      container.completeVisaRenewal,
    ]) {
      vi.spyOn(command, 'execute').mockRejectedValue(new AuthorizationError('cross-tenant'));
    }
    const app = buildServer(loadEnv({}), container);
    const base = `/cases/${id('01')}/visa-renewals/${id('02')}`;
    const requests = [
      {
        url: `${base}/contact-activities`,
        payload: {
          organizationId: id('03'),
          channel: 'phone',
          occurredAt: '2026-08-14T10:00:00.000Z',
          purpose: 'Synthetic follow-up',
          outcome: 'Synthetic result',
        },
      },
      {
        url: `${base}/renewed-authorization`,
        payload: { documentVersionId: id('04'), validFrom: '2026-08-14', validTo: '2027-08-13' },
      },
      {
        url: `${base}/overlap-reviews/${id('05')}/resolve`,
        payload: { resolutionCode: 'reviewed' },
      },
      { url: `${base}/complete`, payload: { taskId: id('06') } },
    ];
    for (const request of requests) {
      const response = await app.inject({ method: 'POST', headers, ...request });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('requires authentication and an idempotency key on every new mutation endpoint', async () => {
    const app = buildServer(loadEnv({}));
    const base = `/cases/${id('01')}/visa-renewals/${id('02')}`;
    for (const url of [
      `${base}/contact-activities`,
      `${base}/renewed-authorization`,
      `${base}/overlap-reviews/${id('05')}/resolve`,
      `${base}/complete`,
    ]) {
      expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(401);
    }
  });
});

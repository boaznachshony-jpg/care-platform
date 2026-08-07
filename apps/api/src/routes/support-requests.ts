import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../env.js';
import { sendError, sendValidationError } from './http-errors.js';

const MAX_MESSAGE_LENGTH = 500;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_REQUESTS = 5;
const recentRequests = new Map<string, number[]>();

const supportRequestSchema = z.object({
  kind: z.enum(['help', 'feedback']),
  replyEmail: z.string().trim().email().max(254),
  message: z.string().trim().min(10).max(MAX_MESSAGE_LENGTH),
  website: z.string().max(0).optional().default(''),
});

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function isRateLimited(key: string, now = Date.now()): boolean {
  const threshold = now - RATE_LIMIT_WINDOW_MS;
  const active = (recentRequests.get(key) ?? []).filter((timestamp) => timestamp > threshold);
  if (active.length >= RATE_LIMIT_REQUESTS) {
    recentRequests.set(key, active);
    return true;
  }
  active.push(now);
  recentRequests.set(key, active);
  return false;
}

export function registerSupportRequestRoutes(app: FastifyInstance, env: Env): void {
  app.post<{ Body: unknown }>('/support/requests', async (request, reply) => {
    const parsed = supportRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      // A populated honeypot receives a neutral response so automated senders
      // cannot use validation output to tune around the trap.
      const possibleWebsite = (request.body as { website?: unknown } | null)?.website;
      if (typeof possibleWebsite === 'string' && possibleWebsite.length > 0) {
        reply.status(202).send({ accepted: true });
        return;
      }
      sendValidationError(request, reply, parsed.error);
      return;
    }

    if (isRateLimited(request.ip)) {
      sendError(request, reply, 429, 'SUPPORT_RATE_LIMITED');
      return;
    }

    if (!env.RESEND_API_KEY || !env.SUPPORT_DESTINATION_EMAIL || !env.SUPPORT_FROM_EMAIL) {
      sendError(request, reply, 503, 'SUPPORT_NOT_CONFIGURED');
      return;
    }

    const { kind, replyEmail, message } = parsed.data;
    const category = kind === 'help' ? 'Support request' : 'Improvement suggestion';
    const text = [
      `Request type: ${category}`,
      `Reply address: ${replyEmail}`,
      '',
      message,
      '',
      `Tracking ID: ${request.correlationId}`,
    ].join('\n');

    try {
      const providerResponse = (await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: `CareDesk <${env.SUPPORT_FROM_EMAIL}>`,
          to: [env.SUPPORT_DESTINATION_EMAIL],
          reply_to: replyEmail,
          subject: `CareDesk – ${category}`,
          text,
          html: `<h2>${category}</h2><p><strong>Reply address:</strong> ${escapeHtml(replyEmail)}</p><p>${escapeHtml(message).replaceAll('\n', '<br>')}</p><hr><small>Tracking ID: ${escapeHtml(request.correlationId)}</small>`,
        }),
      })) as unknown as { ok: boolean; status: number };

      if (!providerResponse.ok) {
        request.log.error(
          { correlationId: request.correlationId, providerStatus: providerResponse.status },
          'support provider rejected request',
        );
        sendError(request, reply, 502, 'SUPPORT_DELIVERY_FAILED');
        return;
      }
    } catch {
      request.log.error({ correlationId: request.correlationId }, 'support provider unavailable');
      sendError(request, reply, 502, 'SUPPORT_DELIVERY_FAILED');
      return;
    }

    reply.status(202).send({ accepted: true });
  });
}

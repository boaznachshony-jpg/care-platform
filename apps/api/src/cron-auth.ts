import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from './env.js';
import { sendError } from './routes/http-errors.js';

/**
 * Hash both sides before comparing so `timingSafeEqual` always gets equal
 * lengths - it throws otherwise, and the length of the supplied header would
 * otherwise leak through which branch ran.
 */
function secureEqual(actual: string, expected: string): boolean {
  const left = createHash('sha256').update(actual).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

/**
 * The scheduler's only credential.
 *
 * Extracted from the billing collection route when the data-loss scan became
 * the second scheduled endpoint. Two copies of an authentication check is how
 * one of them ends up subtly weaker - the unset-secret case in particular:
 * without the `!env.CRON_SECRET` guard, an unconfigured deployment accepts the
 * literal header `Bearer undefined`.
 */
export function isAuthorizedCronRequest(request: FastifyRequest, env: Env): boolean {
  if (!env.CRON_SECRET) return false;
  return secureEqual(request.headers.authorization ?? '', `Bearer ${env.CRON_SECRET}`);
}

export function rejectUnauthorizedCron(
  request: FastifyRequest,
  reply: FastifyReply,
  env: Env,
): boolean {
  if (isAuthorizedCronRequest(request, env)) return false;
  sendError(request, reply, 401, 'UNAUTHENTICATED');
  return true;
}

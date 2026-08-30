import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Env } from './env.js';
import type { RateLimiter, RouteRateLimit } from './rate-limit.js';
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

const MINUTE_MS = 60_000;

/**
 * `CRON_SECRET` is a bearer token on a publicly reachable URL, and
 * `isAuthorizedCronRequest` is a constant-time comparison against it - which
 * defeats a timing attack but does nothing about an attacker who simply keeps
 * guessing. Ten attempts a minute per address is far more than the scheduler
 * needs (these endpoints run nightly and are otherwise called by hand during a
 * restore drill) and far less than a guessing run wants.
 */
export const CRON_RATE_LIMIT = {
  max: 10,
  timeWindow: MINUTE_MS,
  bucket: 'cron',
} as const satisfies RouteRateLimit;

/**
 * Keyed by address rather than by principal, and registered as a `preHandler`
 * so it runs *before* the route body checks the secret: a limiter that only
 * counted authorized calls would be counting the requests that are not the
 * problem.
 */
export function makeCronRateLimit(
  limiter: RateLimiter,
  policy: RouteRateLimit = CRON_RATE_LIMIT,
): preHandlerHookHandler {
  return async (request, reply) => {
    const decision = await limiter.consume(
      `cron:${policy.bucket}:${request.ip}`,
      policy.max,
      policy.timeWindow,
    );
    if (decision.allowed) return;
    if (decision.retryAfterSeconds) reply.header('retry-after', decision.retryAfterSeconds);
    sendError(request, reply, 429, 'RATE_LIMITED');
  };
}

import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Env } from './env.js';
import { sendError } from './routes/http-errors.js';

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/** Typed route metadata shared by Fastify route declarations and the enforcing pre-handler. */
export interface RouteRateLimit {
  max: number;
  timeWindow: number;
  bucket: string;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    rateLimit?: RouteRateLimit;
  }
  interface FastifyRequest {
    /** Set once per request by registerClientAddress; read through clientAddress(). */
    clientAddress?: string;
  }
}

/**
 * SEC-INPUT-02. On Vercel every request arrives through the platform's edge,
 * so `request.ip` is the platform hop and every per-IP bucket collapses into
 * one shared budget: the first stranger to exhaust it locks everybody out of
 * the support form and the cron endpoints. Vercel puts the caller's address
 * in `x-real-ip`, which is trusted *only* when `VERCEL` is set - on a laptop
 * or in CI a caller could otherwise reset its own budget by sending the header.
 *
 * Deliberately not `trustProxy: true`: that also rewrites request.host and
 * request.protocol from forwarded headers, which nothing here needs.
 */
export function resolveClientAddress(
  request: Pick<FastifyRequest, 'headers' | 'ip'>,
  env: Pick<Env, 'VERCEL'>,
): string {
  if (env.VERCEL) {
    const header = request.headers['x-real-ip'];
    const first = (Array.isArray(header) ? header[0] : header)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.ip;
}

/** Resolves the address once per request so every limiter reads the same answer. */
export function registerClientAddress(app: FastifyInstance, env: Pick<Env, 'VERCEL'>): void {
  app.addHook('onRequest', async (request) => {
    request.clientAddress = resolveClientAddress(request, env);
  });
}

/** The address a per-IP limiter must key on. Falls back to request.ip off-server. */
export function clientAddress(request: FastifyRequest): string {
  return request.clientAddress ?? request.ip;
}

/**
 * Shared after-authentication limiter: keyed by tenant and user so one family
 * cannot spend another's quota; the client address is only the fail-closed
 * fallback when the hook is ordered before authentication. Lifted from
 * product-differentiation.ts so the invitation routes (SEC-AUTHZ-05) do not
 * grow a third copy.
 */
export function makePrincipalRateLimit(
  limiter: RateLimiter,
  keyPrefix: string,
  policy: RouteRateLimit,
): preHandlerHookHandler {
  return async (request, reply) => {
    const principal = request.actor
      ? `${request.actor.tenantId}:${request.actor.userId}`
      : `unauthenticated:${clientAddress(request)}`;
    const decision = await limiter.consume(
      `${keyPrefix}:${policy.bucket}:${principal}`,
      policy.max,
      policy.timeWindow,
    );
    if (decision.allowed) return;
    if (decision.retryAfterSeconds) reply.header('retry-after', decision.retryAfterSeconds);
    sendError(request, reply, 429, 'RATE_LIMITED');
  };
}

/** Provider-neutral port. A Redis/KV implementation can replace this without route changes. */
export interface RateLimiter {
  readonly kind: 'memory' | 'distributed';
  consume(key: string, limit: number, windowMs: number, now?: number): Promise<RateLimitDecision>;
}

export class InMemoryRateLimiter implements RateLimiter {
  readonly kind = 'memory' as const;
  private readonly requests = new Map<string, number[]>();

  async consume(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): Promise<RateLimitDecision> {
    const threshold = now - windowMs;
    const active = (this.requests.get(key) ?? []).filter((timestamp) => timestamp > threshold);
    if (active.length >= limit) {
      this.requests.set(key, active);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((active[0]! + windowMs - now) / 1000)),
      };
    }
    active.push(now);
    this.requests.set(key, active);
    return { allowed: true };
  }
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
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

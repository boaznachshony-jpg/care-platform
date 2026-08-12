import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from './rate-limit.js';

describe('InMemoryRateLimiter', () => {
  it('implements the provider-neutral window contract and reports retry timing', async () => {
    const limiter = new InMemoryRateLimiter();
    expect(limiter.kind).toBe('memory');
    expect(await limiter.consume('key', 2, 1_000, 1_000)).toEqual({ allowed: true });
    expect(await limiter.consume('key', 2, 1_000, 1_100)).toEqual({ allowed: true });
    expect(await limiter.consume('key', 2, 1_000, 1_200)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(await limiter.consume('key', 2, 1_000, 2_001)).toEqual({ allowed: true });
  });
});

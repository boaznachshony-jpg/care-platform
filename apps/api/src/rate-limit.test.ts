import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter, resolveClientAddress } from './rate-limit.js';

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

describe('resolveClientAddress', () => {
  const request = { ip: '10.0.0.1', headers: { 'x-real-ip': '203.0.113.5, 198.51.100.1' } };

  it('reads the first x-real-ip value on Vercel', () => {
    expect(resolveClientAddress(request, { VERCEL: '1' })).toBe('203.0.113.5');
  });

  it('falls back to request.ip on Vercel when the header is absent or blank', () => {
    expect(resolveClientAddress({ ip: '10.0.0.1', headers: {} }, { VERCEL: '1' })).toBe('10.0.0.1');
    expect(
      resolveClientAddress({ ip: '10.0.0.1', headers: { 'x-real-ip': '  ' } }, { VERCEL: '1' }),
    ).toBe('10.0.0.1');
  });

  it('never trusts the header off Vercel', () => {
    expect(resolveClientAddress(request, { VERCEL: undefined })).toBe('10.0.0.1');
  });
});

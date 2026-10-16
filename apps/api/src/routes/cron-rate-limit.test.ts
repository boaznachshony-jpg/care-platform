import { describe, expect, it } from 'vitest';
import { buildServer } from '../create-server.js';
import { CRON_RATE_LIMIT } from '../cron-auth.js';
import { loadEnv } from '../env.js';

/**
 * Both scheduled endpoints are publicly reachable URLs whose only credential is
 * the `CRON_SECRET` bearer token. `isAuthorizedCronRequest` compares it in
 * constant time, which settles timing attacks and says nothing about an
 * attacker who just keeps guessing - so the limiter is the control that makes
 * guessing impractical, and it is worth a test that actually exhausts it.
 */
const CRON_ROUTES = ['/internal/jobs/data-integrity-scan', '/billing/jobs/collect'] as const;

describe('scheduled job routes', () => {
  it.each(CRON_ROUTES)('bounds a guessing run against CRON_SECRET on %s', async (url) => {
    const app = buildServer(loadEnv({}));

    const statuses: number[] = [];
    for (let attempt = 0; attempt <= CRON_RATE_LIMIT.max; attempt += 1) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: 'Bearer not-the-secret' },
      });
      statuses.push(response.statusCode);
    }

    // Every attempt within the budget is refused on its merits...
    expect(statuses.slice(0, CRON_RATE_LIMIT.max)).toEqual(
      Array.from({ length: CRON_RATE_LIMIT.max }, () => 401),
    );
    // ...and the one past it never reaches the comparison at all.
    expect(statuses.at(-1)).toBe(429);
  });

  it('spends one budget across both jobs, because they share the one secret', async () => {
    const app = buildServer(loadEnv({}));

    for (let attempt = 0; attempt < CRON_RATE_LIMIT.max; attempt += 1) {
      await app.inject({ method: 'GET', url: '/billing/jobs/collect' });
    }

    // A limiter scoped per route would leave an attacker `max` guesses per
    // endpoint against the same token, which is not the budget that was meant.
    const response = await app.inject({
      method: 'GET',
      url: '/internal/jobs/data-integrity-scan',
    });
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
  });
});

/**
 * SEC-INPUT-02. On Vercel `request.ip` is the platform hop, so without this
 * every caller shared one ten-request budget and the first guessing run locked
 * the real scheduler out. The header is trusted only when VERCEL is set.
 */
describe('scheduled job rate limit client address', () => {
  const url = '/billing/jobs/collect';

  it('gives each x-real-ip its own budget on Vercel', async () => {
    const app = buildServer(loadEnv({ VERCEL: '1' }));
    for (let attempt = 0; attempt < CRON_RATE_LIMIT.max; attempt += 1) {
      await app.inject({ method: 'GET', url, headers: { 'x-real-ip': '203.0.113.10' } });
    }
    const exhausted = await app.inject({
      method: 'GET',
      url,
      headers: { 'x-real-ip': '203.0.113.10' },
    });
    expect(exhausted.statusCode).toBe(429);
    const other = await app.inject({
      method: 'GET',
      url,
      headers: { 'x-real-ip': '203.0.113.11' },
    });
    expect(other.statusCode).toBe(401);
  });

  it('ignores x-real-ip off Vercel so a caller cannot reset its own budget', async () => {
    const app = buildServer(loadEnv({}));
    for (let attempt = 0; attempt < CRON_RATE_LIMIT.max; attempt += 1) {
      await app.inject({ method: 'GET', url, headers: { 'x-real-ip': '203.0.113.10' } });
    }
    const forged = await app.inject({
      method: 'GET',
      url,
      headers: { 'x-real-ip': '203.0.113.11' },
    });
    expect(forged.statusCode).toBe(429);
  });
});

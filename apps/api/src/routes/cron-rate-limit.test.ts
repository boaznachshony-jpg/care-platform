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

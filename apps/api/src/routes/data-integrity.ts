import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import { CRON_RATE_LIMIT, makeCronRateLimit, rejectUnauthorizedCron } from '../cron-auth.js';
import type { Env } from '../env.js';
import { safeErrorDetails } from '../plugins/safe-error.js';
import type { RateLimiter } from '../rate-limit.js';
import { sendError } from './http-errors.js';

/**
 * The nightly "is anyone's data smaller than it was" job.
 *
 * Scheduled alongside the billing collection in `apps/api/vercel.json`, and
 * authenticated the same way, by `CRON_SECRET`. Deliberately not behind a user
 * session: there is no actor, and it must run when nobody is looking, which is
 * exactly when the loss it detects happens.
 *
 * The response carries the signals so the endpoint is also callable by hand
 * during the restore drill and during an incident - a detector you cannot run
 * on demand is one you cannot use to confirm a fix. It carries counts only.
 */
export function registerDataIntegrityRoutes(
  app: FastifyInstance,
  container: Container,
  env: Env,
  rateLimiter: RateLimiter,
): void {
  app.get(
    '/internal/jobs/data-integrity-scan',
    {
      config: { rateLimit: CRON_RATE_LIMIT },
      preHandler: makeCronRateLimit(rateLimiter),
    },
    async (request, reply) => {
      if (rejectUnauthorizedCron(request, reply, env)) return;
      try {
        const result = await container.scanForSilentDataLoss.execute();
        if (result.signals.length > 0) {
          // Logged here as well as by the alert sink, at the request level, so
          // the scan's own request line carries the finding. The two paths fail
          // for different reasons and this is the cheaper of them.
          request.log.error(
            { signals: result.signals.length, scannedAt: result.scannedAt },
            'data-loss scan raised signals',
          );
        }
        reply.send(result);
      } catch (error) {
        request.log.error(safeErrorDetails(error), 'Data-loss scan failed');
        // 503 rather than 500: a scan that could not run is a missing
        // measurement, and Vercel retries a failed cron invocation.
        return sendError(request, reply, 503, 'DATA_INTEGRITY_SCAN_UNAVAILABLE');
      }
    },
  );
}

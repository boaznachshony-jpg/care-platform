import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@caredesk/schemas';
import type { Env } from './env.js';
import { registerCorrelationId } from './plugins/correlation-id.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { denyByDefault } from './plugins/deny-by-default.js';

/**
 * No PII in logs (SECURITY.md): redact the common places a bearer token,
 * cookie, or manually-entered secret field could end up.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'body.password',
  'body.bankAccountNumber',
  'body.passportNumber',
];

export function buildServer(env: Env): FastifyInstance {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    },
  });

  void app.register(cors, {
    origin: env.CORS_ORIGINS.split(',').map((origin) => origin.trim()),
  });

  registerCorrelationId(app, env.CORRELATION_HEADER);
  registerErrorHandler(app);

  app.get('/health', async () => {
    const response: HealthResponse = {
      status: 'ok',
      service: '@caredesk/api',
      timestamp: new Date().toISOString(),
    };
    return response;
  });

  app.get('/ready', async () => {
    const response: HealthResponse = {
      status: 'ok',
      service: '@caredesk/api',
      timestamp: new Date().toISOString(),
    };
    return response;
  });

  // Proves the deny-by-default shape works end-to-end before any real
  // AuthorizationService exists — remove once Milestone 1 wires a real one.
  app.get('/protected/ping', { preHandler: denyByDefault }, async () => {
    return { status: 'ok' };
  });

  return app;
}

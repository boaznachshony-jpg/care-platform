import type { IncomingMessage, ServerResponse } from 'node:http';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@caredesk/schemas';
import { buildContainer, type Container } from './container.js';
import { loadEnv } from './env.js';
import type { Env } from './env.js';
import { registerCorrelationId } from './plugins/correlation-id.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { denyByDefault } from './plugins/deny-by-default.js';
import { registerCaseRoutes } from './routes/cases.js';
import { registerCaseSubResourceRoutes } from './routes/case-contacts.js';
import { registerCaseDocumentRoutes } from './routes/case-documents.js';

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

/** RFC 1918 private ranges plus loopback — the addresses a home network hands out. */
const PRIVATE_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

/**
 * Production uses the explicit allowlist and nothing else.
 *
 * Outside production it additionally accepts any private-network origin, so
 * the app can be opened from a phone at http://192.168.x.x:5173 without
 * hand-editing CORS_ORIGINS for whatever address the router happened to
 * assign. The widening is deliberately scoped to private addresses: a public
 * origin is still refused even in development.
 */
export function buildCorsOrigin(
  env: Env,
):
  | true
  | string[]
  | ((origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => void) {
  const allowlist = env.CORS_ORIGINS.split(',').map((origin) => origin.trim());
  if (env.NODE_ENV === 'production') {
    return allowlist;
  }

  return (origin, cb) => {
    // No Origin header at all (curl, same-origin, server-to-server).
    if (!origin) {
      cb(null, true);
      return;
    }
    if (allowlist.includes(origin)) {
      cb(null, true);
      return;
    }
    try {
      cb(null, PRIVATE_HOST.test(new URL(origin).hostname));
    } catch {
      cb(null, false);
    }
  };
}

export function buildServer(env: Env, container: Container = buildContainer(env)): FastifyInstance {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    },
  });

  void app.register(cors, { origin: buildCorsOrigin(env) });

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

  // Fail-closed placeholder retained for any future route added without an
  // explicit authenticate/authorize pair — /cases uses the real chain below.
  app.get('/protected/ping', { preHandler: denyByDefault }, async () => {
    return { status: 'ok' };
  });

  registerCaseRoutes(app, container);
  registerCaseSubResourceRoutes(app, container);
  registerCaseDocumentRoutes(app, container);

  return app;
}

// Vercel imports the default export as a Node.js function. Fastify must finish
// registering its plugins before its underlying Node server handles requests.
const app = buildServer(loadEnv());
let ready: Promise<void> | undefined;

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  ready ??= app.ready();
  await ready;
  app.server.emit('request', request, response);
}

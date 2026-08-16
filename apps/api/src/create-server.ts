import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@caredesk/schemas';
import { buildContainer, type Container } from './container.js';
import type { Env } from './env.js';
import { registerCorrelationId } from './plugins/correlation-id.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { denyByDefault } from './plugins/deny-by-default.js';
import { registerCaseRoutes } from './routes/cases.js';
import { registerCaseSubResourceRoutes } from './routes/case-contacts.js';
import { registerCaseDocumentRoutes } from './routes/case-documents.js';
import { registerWorkspaceRoutes } from './routes/workspace.js';
import { registerFamilyAccessRoutes } from './routes/family-access.js';
import { registerBillingRoutes } from './routes/billing.js';
import { registerSupportRequestRoutes } from './routes/support-requests.js';
import { registerVisaRenewalRoutes } from './routes/visa-renewals.js';
import { registerSecurityHeaders } from './plugins/security-headers.js';
import { InMemoryRateLimiter } from './rate-limit.js';
import { registerWave5Routes } from './routes/wave5.js';
import { registerProductDifferentiationRoutes } from './routes/product-differentiation.js';
import { registerCanonicalProductIntelligenceRoutes } from './routes/canonical-product-intelligence.js';

/**
 * No PII in logs (SECURITY.md): redact the common places a bearer token,
 * cookie, or manually-entered secret field could end up.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'body',
  'payload',
  'document',
  'identity',
  'passport',
  'bank',
  'authorization',
  'cookie',
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

  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      const encoded = typeof body === 'string' ? body : body.toString('utf8');
      done(null, Object.fromEntries(new URLSearchParams(encoded)));
    },
  );

  void app.register(cors, {
    origin: buildCorsOrigin(env),
    // @fastify/cors defaults to GET, HEAD and POST. CareDesk also persists
    // workspaces, files, family roles and billing state through mutating
    // browser requests, so those methods must be present in the preflight
    // response or the browser blocks them before Fastify sees the request.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  registerCorrelationId(app, env.CORRELATION_HEADER);
  registerSecurityHeaders(app, env);
  registerErrorHandler(app);
  const supportRateLimiter = new InMemoryRateLimiter();
  const productRateLimiter = new InMemoryRateLimiter();

  app.get('/health', async () => {
    const response: HealthResponse = {
      status: 'ok',
      service: '@caredesk/api',
      timestamp: new Date().toISOString(),
    };
    return response;
  });

  app.get('/ready', async (_request, reply) => {
    const readiness = await container.readiness();
    if (!readiness.ready) {
      reply.status(503).send({
        status: 'not-ready',
        service: '@caredesk/api',
        timestamp: new Date().toISOString(),
        reasons: readiness.reasons,
        checks: readiness.checks,
        rateLimiting: { support: supportRateLimiter.kind },
      });
      return;
    }
    const response: HealthResponse & {
      checks: typeof readiness.checks;
      rateLimiting: { support: string };
    } = {
      status: 'ok',
      service: '@caredesk/api',
      timestamp: new Date().toISOString(),
      checks: readiness.checks,
      rateLimiting: { support: supportRateLimiter.kind },
    };
    reply.send(response);
  });

  // Fail-closed placeholder retained for any future route added without an
  // explicit authenticate/authorize pair — /cases uses the real chain below.
  app.get('/protected/ping', { preHandler: denyByDefault }, async () => {
    return { status: 'ok' };
  });

  registerCaseRoutes(app, container);
  registerCaseSubResourceRoutes(app, container);
  registerCaseDocumentRoutes(app, container);
  registerWorkspaceRoutes(app, container);
  registerFamilyAccessRoutes(app, container, env);
  registerBillingRoutes(app, container, env);
  registerVisaRenewalRoutes(app, container);
  registerSupportRequestRoutes(app, env, supportRateLimiter);
  registerWave5Routes(app, container);
  registerProductDifferentiationRoutes(app, container, productRateLimiter);
  registerCanonicalProductIntelligenceRoutes(app, container);

  return app;
}

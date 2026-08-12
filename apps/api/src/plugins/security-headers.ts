import type { FastifyInstance } from 'fastify';
import type { Env } from '../env.js';

export const API_SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-security-policy':
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox",
  'cross-origin-opener-policy': 'same-origin',
  // The web client and API are separate Vercel deployments. CORS remains the
  // access-control boundary, so CORP must not block an approved cross-origin client.
  'cross-origin-resource-policy': 'cross-origin',
  'permissions-policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
} as const;

export function registerSecurityHeaders(app: FastifyInstance, env: Env): void {
  app.addHook('onSend', async (_request, reply) => {
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      reply.header(name, value);
    }
    if (env.NODE_ENV === 'production') {
      reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
  });
}

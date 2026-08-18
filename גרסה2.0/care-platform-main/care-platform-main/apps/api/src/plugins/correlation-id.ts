import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}

/**
 * Every request gets a correlation id — reused from the client if it sent
 * one, generated otherwise — and it's echoed back on the response so a
 * user-reported issue can be traced through logs, audit events, and error
 * envelopes (Constitution §14/§24).
 */
export function registerCorrelationId(app: FastifyInstance, headerName: string): void {
  app.addHook('onRequest', async (request, reply) => {
    const incoming = request.headers[headerName];
    const correlationId =
      typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
    request.correlationId = correlationId;
    reply.header(headerName, correlationId);
  });
}

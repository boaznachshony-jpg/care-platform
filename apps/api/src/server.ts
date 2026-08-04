import type { IncomingMessage, ServerResponse } from 'node:http';
import Fastify from 'fastify';
import { buildServer } from './create-server.js';
import { loadEnv } from './env.js';

export { buildCorsOrigin, buildServer } from './create-server.js';

/**
 * Vercel's Fastify preset discovers `src/server.ts` as its serverless entrypoint.
 * Keep it as a thin adapter around the same server factory used by local runs
 * and tests so deployed routes cannot drift from the verified application.
 */
export const vercelApp: ReturnType<typeof Fastify> = buildServer(loadEnv());
let ready: ReturnType<typeof vercelApp.ready> | undefined;

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  ready ??= vercelApp.ready();
  await ready;
  vercelApp.server.emit('request', request, response);
}

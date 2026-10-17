import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildServer } from '../../api/src/create-server.js';
import { buildContainer, DEV_TOKEN } from '../../api/src/container.js';
import { loadEnv } from '../../api/src/env.js';
import fixture from '../src/ux-v2/fixture.json';
import { externalPreviewOrigins } from './external-policy.js';

export async function createExternalPreviewApi(
  source: Record<string, string | undefined>,
): Promise<ReturnType<typeof buildServer>> {
  const origins = externalPreviewOrigins(source);
  // Deliberate allowlist, never process.env: even inherited Vercel project
  // credentials cannot select a database, Supabase, mail or payment provider.
  const env = loadEnv({
    NODE_ENV: 'development',
    LOG_LEVEL: 'error',
    CORS_ORIGINS: origins.join(','),
    BILLING_PROVIDER: 'disabled',
    AI_PROVIDER: 'mock',
  });
  const container = buildContainer(env);
  if (container.pool) throw new Error('UX preview must use in-memory repositories.');
  const app = buildServer(env, container);
  const seeded = await app.inject({
    method: 'POST',
    url: '/cases',
    headers: { authorization: `Bearer ${DEV_TOKEN}` },
    payload: {
      legacyClientId: fixture.clientId,
      careRecipient: { fullName: fixture.profile.recipientName },
      employer: { fullName: fixture.profile.employerName, relationshipToRecipient: 'child' },
      caregiver: {
        legalName: fixture.profile.caregiverName,
        nationality: fixture.profile.caregiverCountry,
      },
      startDate: fixture.profile.employmentStartDate,
    },
  });
  if (seeded.statusCode !== 201) throw new Error('Could not seed the isolated UX preview API.');
  return app;
}

let ready: ReturnType<typeof createExternalPreviewApi> | undefined;

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  // The routing variables contain no credentials and serve only as a
  // fail-closed deployment gate. All application configuration is above.
  const source = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
  };
  try {
    const origins = externalPreviewOrigins(source);
    const host = request.headers.host;
    if (!host || !origins.includes(`https://${host}`)) throw new Error('Unexpected preview host.');
    ready ??= createExternalPreviewApi(source);
    const app = await ready;
    request.url = (request.url ?? '/').replace(/^\/__ux_api(?=\/|\?|$)/, '') || '/';
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    app.server.emit('request', request, response);
  } catch {
    response.statusCode = 503;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ error: 'isolated_preview_unavailable' }));
  }
}

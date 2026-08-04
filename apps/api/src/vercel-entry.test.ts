import { describe, expect, it } from 'vitest';
import app from './index.js';
import { vercelApp } from './server.js';

describe('Vercel Fastify entrypoint', () => {
  it('exports a Fastify server and serves health without opening a local socket', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: '@caredesk/api' });
  });

  it('keeps the Vercel adapter on the same protected route set as the application', async () => {
    for (const url of ['/workspace', '/family/members', '/billing/subscription']) {
      const response = await vercelApp.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(401);
      expect(response.json(), url).toMatchObject({ code: 'UNAUTHENTICATED' });
    }
  });
});

import { describe, expect, it } from 'vitest';
import app from './index.js';

describe('Vercel Fastify entrypoint', () => {
  it('exports a Fastify server and serves health without opening a local socket', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: '@caredesk/api' });
  });
});

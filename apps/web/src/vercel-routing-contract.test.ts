import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Rewrite {
  readonly source: string;
  readonly destination: string;
}

const readWebFile = (path: string) =>
  readFile(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

describe('Vercel web routing contract', () => {
  it('routes nothing to a hardcoded cross-origin host', async () => {
    // REL-02. The removed rewrite sent `/api/:path*` to the literal production
    // API host on every deployment, previews included. It was dead - the client
    // builds absolute URLs from API_BASE_URL and nothing in apps/web/src
    // fetches a relative /api path - but dead config aimed at production is one
    // relative fetch away from becoming live, and that fetch would not look
    // like a mistake in review.
    const rewrites = JSON.parse(await readWebFile('vercel.json')).rewrites as Rewrite[];
    for (const rewrite of rewrites) {
      expect(rewrite.destination, `${rewrite.source} must stay same-origin`).not.toMatch(
        /^https?:\/\//,
      );
    }
  });

  it('keeps the SPA fallback', async () => {
    const rewrites = JSON.parse(await readWebFile('vercel.json')).rewrites as Rewrite[];
    expect(rewrites).toContainEqual({ source: '/(.*)', destination: '/index.html' });
  });
});

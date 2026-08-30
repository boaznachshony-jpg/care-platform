import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Rewrite {
  readonly source: string;
  readonly destination: string;
}

/**
 * Locate `apps/web/vercel.json` without depending on `import.meta.url`.
 *
 * Vite rewrites `import.meta.url` in transformed modules, so a path built from
 * it points at the served module URL rather than at the file on disk, and
 * `../vercel.json` then resolves above the package. Both assertions in this file
 * read the same config, which is why both failed together: not two defects, one
 * unreadable path.
 *
 * `process.cwd()` is the package root under vitest, so it is the stable anchor.
 * The walk upward keeps the test working if it is ever run from the repository
 * root instead, which is the other way this file gets executed.
 */
async function readWebConfig(): Promise<{ rewrites: Rewrite[] }> {
  let directory = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    for (const candidate of [
      resolve(directory, 'vercel.json'),
      resolve(directory, 'apps/web/vercel.json'),
    ]) {
      try {
        const parsed = JSON.parse(await readFile(candidate, 'utf8')) as {
          rewrites?: Rewrite[];
          buildCommand?: string;
        };
        // apps/api also has a vercel.json with rewrites, so matching on the
        // presence of `rewrites` alone would silently assert against the wrong
        // deployment. The web build command is what identifies this one.
        if (parsed.rewrites && parsed.buildCommand?.includes('@caredesk/web')) {
          return { rewrites: parsed.rewrites };
        }
      } catch {
        // Not here; keep looking rather than failing on the first miss.
      }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Could not find apps/web/vercel.json starting from ${process.cwd()}`);
}

describe('Vercel web routing contract', () => {
  it('routes nothing to a hardcoded cross-origin host', async () => {
    // REL-02. The removed rewrite sent `/api/:path*` to the literal production
    // API host on every deployment, previews included. It was dead - the client
    // builds absolute URLs from API_BASE_URL and nothing in apps/web/src
    // fetches a relative /api path - but dead config aimed at production is one
    // relative fetch away from becoming live, and that fetch would not look
    // like a mistake in review.
    const { rewrites } = await readWebConfig();
    expect(rewrites.length).toBeGreaterThan(0);
    for (const rewrite of rewrites) {
      expect(rewrite.destination, `${rewrite.source} must stay same-origin`).not.toMatch(
        /^https?:\/\//,
      );
    }
  });

  it('keeps the SPA fallback', async () => {
    const { rewrites } = await readWebConfig();
    expect(rewrites).toContainEqual({ source: '/(.*)', destination: '/index.html' });
  });
});

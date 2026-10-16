import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Header {
  readonly key: string;
  readonly value: string;
}

interface HeaderRule {
  readonly source: string;
  readonly headers: Header[];
}

/**
 * Locate `apps/web/vercel.json` from `process.cwd()`, the same way
 * `vercel-routing-contract.test.ts` does and for the same reason: Vite
 * rewrites `import.meta.url`, so a path built from it does not point at the
 * file on disk.
 */
async function readWebConfig(): Promise<{ path: string; headers: HeaderRule[] }> {
  let directory = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    for (const candidate of [
      resolve(directory, 'vercel.json'),
      resolve(directory, 'apps/web/vercel.json'),
    ]) {
      try {
        const parsed = JSON.parse(await readFile(candidate, 'utf8')) as {
          headers?: HeaderRule[];
          buildCommand?: string;
        };
        if (parsed.buildCommand?.includes('@caredesk/web')) {
          return { path: candidate, headers: parsed.headers ?? [] };
        }
      } catch {
        // Not here; keep looking.
      }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Could not find apps/web/vercel.json starting from ${process.cwd()}`);
}

function catchAll(rules: HeaderRule[]): HeaderRule {
  const rule = rules.find((entry) => entry.source === '/(.*)');
  if (!rule) throw new Error('vercel.json has no headers entry for "/(.*)"');
  return rule;
}

function headerValue(rule: HeaderRule, name: string): string {
  const header = rule.headers.find((entry) => entry.key.toLowerCase() === name.toLowerCase());
  if (!header) throw new Error(`catch-all headers entry is missing ${name}`);
  return header.value;
}

/**
 * SEC-WEB-03 / SEC-INFRA-02. The API has set these headers since the first
 * release; the web origin, which is where the customer's browser actually
 * runs, set none of them. This file is what makes removing one a red diff.
 */
describe('Vercel web security headers', () => {
  it('sets every browser security header on every response', async () => {
    const { headers } = await readWebConfig();
    const rule = catchAll(headers);
    const names = rule.headers.map((header) => header.key).sort();
    expect(names).toEqual(
      [
        'Content-Security-Policy-Report-Only',
        'Permissions-Policy',
        'Referrer-Policy',
        'Strict-Transport-Security',
        'X-Content-Type-Options',
        'X-Frame-Options',
      ].sort(),
    );
  });

  it('refuses framing twice: X-Frame-Options and frame-ancestors', async () => {
    const { headers } = await readWebConfig();
    const rule = catchAll(headers);
    expect(headerValue(rule, 'X-Frame-Options')).toBe('DENY');
    expect(headerValue(rule, 'Content-Security-Policy-Report-Only')).toContain(
      "frame-ancestors 'none'",
    );
  });

  it('pins the values that protect the customer, not only the header names', async () => {
    const { headers } = await readWebConfig();
    const rule = catchAll(headers);
    expect(headerValue(rule, 'X-Content-Type-Options')).toBe('nosniff');
    expect(headerValue(rule, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headerValue(rule, 'Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
    for (const feature of ['camera', 'geolocation', 'microphone', 'payment', 'usb']) {
      expect(headerValue(rule, 'Permissions-Policy')).toContain(`${feature}=()`);
    }
  });

  it('keeps the CSP closed where it matters even while report-only', async () => {
    const { headers } = await readWebConfig();
    const csp = headerValue(catchAll(headers), 'Content-Security-Policy-Report-Only');
    const directives = new Map(
      csp
        .split(';')
        .map((directive) => directive.trim())
        .filter(Boolean)
        .map((directive) => {
          const [name, ...values] = directive.split(/\s+/);
          return [name, values] as const;
        }),
    );
    expect(directives.get('default-src')).toEqual(["'self'"]);
    // The app is a bundled SPA: there is no inline script and no third-party
    // script, so anything wider than 'self' here is a mistake, not a need.
    expect(directives.get('script-src')).toEqual(["'self'"]);
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'self'"]);
    expect(directives.get('form-action')).toEqual(["'self'"]);
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
    // Every origin the browser bundle talks to, and nothing else.
    expect(directives.get('connect-src')).toEqual([
      "'self'",
      'https://care-platform-api.vercel.app',
      'https://*.supabase.co',
      'wss://*.supabase.co',
    ]);
  });

  it('mirrors the same headers into vite preview so Playwright runs under them', async () => {
    const { path, headers } = await readWebConfig();
    const viteConfig = await readFile(resolve(dirname(path), 'vite.config.ts'), 'utf8');
    for (const header of catchAll(headers).headers) {
      expect(viteConfig, `vite.config.ts preview.headers is missing ${header.key}`).toContain(
        `'${header.key}'`,
      );
      expect(viteConfig, `vite.config.ts preview.headers has a stale ${header.key}`).toContain(
        header.value,
      );
    }
  });
});

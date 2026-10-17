import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './client.js';
import { API_ERROR_CONTRACT, describeApiError, type ApiErrorMessageKey } from './error-contract.js';

/**
 * `process.cwd()` is the package root under vitest (see
 * vercel-routing-contract.test.ts); walking up to the workspace root keeps this
 * working when the suite is run from the repository root instead.
 */
function workspaceRoot(): string {
  let directory = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) return directory;
    directory = dirname(directory);
  }
  throw new Error('workspace root not found above ' + process.cwd());
}
const ROOT = workspaceRoot();
const API_SRC = join(ROOT, 'apps', 'api', 'src');
const RESOURCES = join(ROOT, 'packages', 'i18n', 'src', 'resources');

/**
 * Sent only to the payment provider's webhook, never to a browser, so the web
 * client has nothing to say about them.
 */
const SERVER_TO_SERVER_CODES = new Set([
  'INVALID_BILLING_WEBHOOK',
  'BILLING_WEBHOOK_VERIFICATION_FAILED',
]);

function apiSources(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) apiSources(path, files);
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) files.push(path);
  }
  return files;
}

/** Every `sendError(request, reply, <status>, '<CODE>')` with literal arguments. */
function literalApiErrors(): Array<{ status: number; code: string }> {
  const found = new Map<string, { status: number; code: string }>();
  const pattern = /sendError\(\s*[^,]+,\s*[^,]+,\s*(\d{3}),\s*'([A-Z0-9_]+)'/g;
  for (const file of apiSources(API_SRC)) {
    for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
      const status = Number(match[1]);
      const code = match[2]!;
      found.set(`${code}|${status}`, { status, code });
    }
  }
  return [...found.values()];
}

function lookup(resource: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
    return undefined;
  }, resource);
}

const he: unknown = JSON.parse(readFileSync(join(RESOURCES, 'he.json'), 'utf8'));
const en: unknown = JSON.parse(readFileSync(join(RESOURCES, 'en.json'), 'utf8'));

/** Every key the table or a fallback can return. */
function reachableKeys(): Set<ApiErrorMessageKey> {
  const keys = new Set<ApiErrorMessageKey>(API_ERROR_CONTRACT.map((row) => row.messageKey));
  for (let status = 400; status < 600; status += 1) {
    keys.add(describeApiError({ status, code: 'NO_SUCH_CODE' }).messageKey);
  }
  keys.add(describeApiError(new TypeError('Failed to fetch')).messageKey);
  keys.add(describeApiError('not an error').messageKey);
  return keys;
}

describe('API error contract (H1)', () => {
  it('has its own row for every literal (status, code) the API sends to a browser', () => {
    const sent = literalApiErrors().filter(({ code }) => !SERVER_TO_SERVER_CODES.has(code));
    // The scan itself must be working: these are known to exist.
    expect(sent.length).toBeGreaterThan(30);
    expect(sent).toContainEqual({ status: 409, code: 'VERSION_CONFLICT' });

    const missing = sent.filter(
      ({ status, code }) =>
        !API_ERROR_CONTRACT.some(
          (row) => row.code === code && (row.status === status || row.status === '*'),
        ),
    );
    expect(missing, 'add a row to apps/web/src/api/error-contract.ts for each').toEqual([]);
  });

  it('has no duplicate (code, status) rows', () => {
    const ids = API_ERROR_CONTRACT.map((row) => `${row.code}|${row.status}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points every reachable message at real Hebrew and English text', () => {
    for (const key of reachableKeys()) {
      const hebrew = lookup(he, key);
      const english = lookup(en, key);
      expect(typeof hebrew, `${key} in he.json`).toBe('string');
      expect(typeof english, `${key} in en.json`).toBe('string');
      expect(hebrew as string, `${key} in he.json is Hebrew`).toMatch(/[֐-׿]/);
      expect((english as string).length, `${key} in en.json`).toBeGreaterThan(0);
    }
  });

  it('keeps errors.api identical in shape across Hebrew and English, with no unused key', () => {
    const heKeys = Object.keys(lookup(he, 'errors.api') as object).sort();
    const enKeys = Object.keys(lookup(en, 'errors.api') as object).sort();
    expect(enKeys).toEqual(heKeys);
    const reachable = [...reachableKeys()].map((key) => key.replace('errors.api.', '')).sort();
    expect(heKeys).toEqual(reachable);
  });

  it('reads the ApiRequestError the client already throws', () => {
    expect(describeApiError(new ApiRequestError(409, 'VERSION_CONFLICT'))).toEqual({
      messageKey: 'errors.api.conflict',
      retryable: false,
    });
    expect(describeApiError(new ApiRequestError(401, 'UNAUTHENTICATED'))).toEqual({
      messageKey: 'errors.api.sessionExpired',
      retryable: false,
    });
  });

  it('matches a code whose status varies by route', () => {
    expect(describeApiError({ status: 409, code: 'FORBIDDEN' }).messageKey).toBe(
      'errors.api.forbidden',
    );
    expect(describeApiError({ status: 409, code: 'NOT_FOUND' }).messageKey).toBe(
      'errors.api.notFound',
    );
  });

  it('falls back to the status class for a code it does not know', () => {
    expect(describeApiError({ status: 503, code: 'SOMETHING_NEW' })).toEqual({
      messageKey: 'errors.api.serviceUnavailable',
      retryable: true,
    });
    expect(describeApiError({ status: 500, code: 'SOMETHING_NEW' })).toEqual({
      messageKey: 'errors.api.server',
      retryable: true,
    });
    expect(describeApiError({ status: 409, code: 'SOMETHING_NEW' })).toEqual({
      messageKey: 'errors.api.conflict',
      retryable: false,
    });
    expect(describeApiError({ status: 418, code: 'SOMETHING_NEW' })).toEqual({
      messageKey: 'errors.api.generic',
      retryable: false,
    });
  });

  it('treats a request that never reached the server as a retryable network failure', () => {
    expect(describeApiError(new TypeError('Failed to fetch'))).toEqual({
      messageKey: 'errors.api.network',
      retryable: true,
    });
    expect(describeApiError(new Error('boom'))).toEqual({
      messageKey: 'errors.api.generic',
      retryable: false,
    });
  });

  /**
   * "Try again" must only be offered where repeating the same request can
   * succeed. On a conflict, a closed month or a rejected shrink it repeats the
   * failure - or worse, invites the person to force a write that was refused
   * to protect their data.
   */
  it('never offers a retry where repeating the request repeats the failure', () => {
    for (const code of [
      'VALIDATION_ERROR',
      'VERSION_CONFLICT',
      'PAYROLL_MONTH_CLOSED',
      'WORKSPACE_SHRINK_REJECTED',
      'FORBIDDEN',
      'NOT_FOUND',
      'TOTAL_MISMATCH',
      'ACCOUNT_FROZEN',
    ]) {
      const row = API_ERROR_CONTRACT.find((candidate) => candidate.code === code);
      expect(row?.retryable, code).toBe(false);
    }
    for (const code of ['RATE_LIMITED', 'INTERNAL_ERROR', 'COMMIT_IN_PROGRESS']) {
      const row = API_ERROR_CONTRACT.find((candidate) => candidate.code === code);
      expect(row?.retryable, code).toBe(true);
    }
  });
});

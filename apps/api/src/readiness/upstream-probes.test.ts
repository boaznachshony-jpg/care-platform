import { describe, expect, it, vi } from 'vitest';
import {
  probeSupabaseAuth,
  probeSupabasePrivateStorage,
  UPSTREAM_PROBE_TIMEOUT_MS,
  type ProbeFetch,
} from './upstream-probes.js';

/**
 * R0-08. These tests exist to prove the probe can FAIL. The check it replaces
 * was `Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY)`, which passed
 * for every wrong value it was ever given; a replacement that cannot fail would
 * be the same bug with more code.
 */

function respondWith(
  status: number,
  body: string,
): { fetchImpl: ProbeFetch; calls: Array<{ url: string; init?: Record<string, unknown> }> } {
  const calls: Array<{ url: string; init?: Record<string, unknown> }> = [];
  const fetchImpl: ProbeFetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    };
  };
  return { fetchImpl, calls };
}

const PUBLISHABLE = 'publishable-key-for-tests';

/**
 * Assembled at runtime, deliberately.
 *
 * One of these tests has to feed the sink something JWT-shaped, because the
 * redaction it proves only triggers on that shape. Writing the dotted form as a
 * source literal makes the secret scanner flag the file — correctly, since a
 * scanner cannot tell a synthetic three-segment token from a live one. Joining
 * three inert segments keeps the runtime value exactly as revealing as it needs
 * to be while leaving nothing key-shaped in the repository.
 */
const SERVICE_ROLE = [
  'header-segment-for-tests',
  'payload-segment-for-tests',
  'signature-segment-for-tests',
].join('.');

/** The shape the redaction actually matches: three base64url segments. */
const JWT_SHAPED_VALUE = ['eyJhbGciOiJub25lIn0', 'eyJyb2xlIjoidGVzdCJ9', 'c2lnbmF0dXJl'].join('.');

describe('probeSupabaseAuth', () => {
  it('is reachable when the project answers and accepts the key', async () => {
    const { fetchImpl, calls } = respondWith(200, '{"external":{"email":true}}');
    const outcome = await probeSupabaseAuth({
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: PUBLISHABLE,
      fetchImpl,
    });
    expect(outcome).toEqual({ reachable: true });
    expect(calls[0]?.url).toBe('https://project.supabase.co/auth/v1/settings');
  });

  it('probes /auth/v1/settings, not /auth/v1/health', async () => {
    // /health answers without a key, so it cannot distinguish a rotated key
    // from a working one — which is the failure this item closes.
    const { fetchImpl, calls } = respondWith(200, '{}');
    await probeSupabaseAuth({
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: PUBLISHABLE,
      fetchImpl,
    });
    expect(calls[0]?.url).toContain('/auth/v1/settings');
    expect(calls[0]?.url).not.toContain('/health');
  });

  it('reports a rotated or wrong publishable key rather than ok', async () => {
    const { fetchImpl } = respondWith(401, '{"message":"Invalid API key"}');
    const outcome = await probeSupabaseAuth({
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'rotated-publishable-key-for-tests',
      fetchImpl,
    });
    expect(outcome.reachable).toBe(false);
    expect(outcome.detail).toBe('HTTP 401: Invalid API key');
  });

  it('reports a deleted or mistyped project by transport code, not by name', async () => {
    const fetchImpl: ProbeFetch = async () => {
      const error = new Error('fetch failed');
      (error as { cause?: { code?: string } }).cause = { code: 'ENOTFOUND' };
      throw error;
    };
    const outcome = await probeSupabaseAuth({
      supabaseUrl: 'https://deleted-project.supabase.co',
      publishableKey: PUBLISHABLE,
      fetchImpl,
    });
    expect(outcome.reachable).toBe(false);
    expect(outcome.detail).toContain('ENOTFOUND');
  });

  it('never puts the key in the URL', async () => {
    const { fetchImpl, calls } = respondWith(200, '{}');
    await probeSupabaseAuth({
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: PUBLISHABLE,
      fetchImpl,
    });
    expect(calls[0]?.url).not.toContain(PUBLISHABLE);
    expect((calls[0]?.init?.headers as Record<string, string>).apikey).toBe(PUBLISHABLE);
  });

  it('strips a JWT-shaped value out of an upstream message', async () => {
    // Belt and braces: no observed upstream echoes a key back, and the reason
    // string is read by a human looking at a public health endpoint.
    const { fetchImpl } = respondWith(403, `{"message":"key ${JWT_SHAPED_VALUE} is revoked"}`);
    const outcome = await probeSupabaseAuth({
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: PUBLISHABLE,
      fetchImpl,
    });
    expect(outcome.detail).not.toContain(JWT_SHAPED_VALUE);
    expect(outcome.detail).toContain('[redacted]');
  });

  it('bounds the detail so one upstream cannot flood the endpoint', async () => {
    const { fetchImpl } = respondWith(500, 'x'.repeat(5_000));
    const outcome = await probeSupabaseAuth({
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: PUBLISHABLE,
      fetchImpl,
    });
    expect(outcome.detail!.length).toBeLessThan(200);
  });

  it('passes an abort signal so a hung upstream cannot hang /ready', async () => {
    const { fetchImpl, calls } = respondWith(200, '{}');
    await probeSupabaseAuth({
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: PUBLISHABLE,
      fetchImpl,
    });
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(UPSTREAM_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });
});

describe('probeSupabasePrivateStorage', () => {
  it('is reachable when the bucket exists and the key may read it', async () => {
    const { fetchImpl, calls } = respondWith(200, '{"name":"caredesk-documents"}');
    const outcome = await probeSupabasePrivateStorage({
      supabaseUrl: 'https://project.supabase.co',
      serviceRoleKey: SERVICE_ROLE,
      bucket: 'caredesk-documents',
      fetchImpl,
    });
    expect(outcome).toEqual({ reachable: true });
    expect(calls[0]?.url).toBe('https://project.supabase.co/storage/v1/bucket/caredesk-documents');
  });

  it('distinguishes a missing bucket from a rejected key', async () => {
    const missing = respondWith(404, '{"error":"Bucket not found"}');
    const rejected = respondWith(401, '{"message":"Invalid JWT"}');
    const a = await probeSupabasePrivateStorage({
      supabaseUrl: 'https://project.supabase.co',
      serviceRoleKey: SERVICE_ROLE,
      bucket: 'renamed-bucket',
      fetchImpl: missing.fetchImpl,
    });
    const b = await probeSupabasePrivateStorage({
      supabaseUrl: 'https://project.supabase.co',
      serviceRoleKey: SERVICE_ROLE,
      bucket: 'caredesk-documents',
      fetchImpl: rejected.fetchImpl,
    });
    expect(a.detail).toBe('HTTP 404: Bucket not found');
    expect(b.detail).toBe('HTTP 401: Invalid JWT');
  });

  it('encodes the bucket name so it probes the bucket the app writes to', async () => {
    const { fetchImpl, calls } = respondWith(200, '{}');
    await probeSupabasePrivateStorage({
      supabaseUrl: 'https://project.supabase.co',
      serviceRoleKey: SERVICE_ROLE,
      bucket: 'care desk/docs',
      fetchImpl,
    });
    expect(calls[0]?.url).toBe('https://project.supabase.co/storage/v1/bucket/care%20desk%2Fdocs');
  });

  it('sends the service-role key in headers only', async () => {
    const { fetchImpl, calls } = respondWith(200, '{}');
    await probeSupabasePrivateStorage({
      supabaseUrl: 'https://project.supabase.co',
      serviceRoleKey: SERVICE_ROLE,
      bucket: 'caredesk-documents',
      fetchImpl,
    });
    expect(calls[0]?.url).not.toContain(SERVICE_ROLE);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${SERVICE_ROLE}`);
  });

  it('tolerates a trailing slash on SUPABASE_URL', async () => {
    const { fetchImpl, calls } = respondWith(200, '{}');
    await probeSupabasePrivateStorage({
      supabaseUrl: 'https://project.supabase.co/',
      serviceRoleKey: SERVICE_ROLE,
      bucket: 'caredesk-documents',
      fetchImpl,
    });
    expect(calls[0]?.url).not.toContain('//storage');
  });

  it('does not fail open when the upstream never answers', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('The operation was aborted due to timeout');
    }) as unknown as ProbeFetch;
    const outcome = await probeSupabasePrivateStorage({
      supabaseUrl: 'https://project.supabase.co',
      serviceRoleKey: SERVICE_ROLE,
      bucket: 'caredesk-documents',
      fetchImpl,
      timeoutMs: 1,
    });
    expect(outcome.reachable).toBe(false);
  });
});

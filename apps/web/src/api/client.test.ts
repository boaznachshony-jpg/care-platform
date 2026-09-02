import { afterEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn(async () => ({
  data: { session: { access_token: 'verified-user-access-token' } },
}));

vi.mock('../auth/client.js', () => ({
  getBrowserAuthClient: () => ({ auth: { getSession } }),
}));

import {
  confirmAssistantChecklist,
  getWorkerPreferences,
  listEmploymentCases,
  prewarmApi,
  resetApiPrewarmForTests,
} from './client.js';
import { newIdempotencyKey } from './idempotency.js';

describe('API authentication', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    getSession.mockClear();
    resetApiPrewarmForTests();
  });

  it('coalesces public API warm-up requests without reading the user session', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([prewarmApi(), prewarmApi()]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/health'),
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
    expect(getSession).not.toHaveBeenCalled();
  });

  it('sends the current Supabase access token instead of the synthetic dev token', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(listEmploymentCases()).resolves.toEqual([]);
    expect(getSession).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/cases'),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer verified-user-access-token',
        }),
      }),
    );
  });
});

describe('getWorkerPreferences', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    getSession.mockClear();
  });

  // Defect: WorkerPortalPage never called GET /worker/preferences at all, so
  // its save always sent a hardcoded consent value instead of what was
  // actually stored. This getter is what closes that gap.
  it('reads the stored worker preference from /worker/preferences', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            preferred_locale: 'he',
            preferred_channel: 'email',
            email_enabled: true,
            whatsapp_enabled: false,
            sms_enabled: false,
            whatsapp_consent: 'revoked',
            sms_consent: 'unknown',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getWorkerPreferences()).resolves.toEqual(
      expect.objectContaining({ whatsapp_consent: 'revoked', sms_consent: 'unknown' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/worker/preferences'),
      expect.objectContaining({ method: undefined }),
    );
  });
});

describe('newIdempotencyKey', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses crypto.randomUUID when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid-fixed-value' });
    expect(newIdempotencyKey()).toBe('uuid-fixed-value');
  });

  // Defect: crypto.randomUUID only exists in secure contexts, and this app
  // is deliberately reachable over plain http on a phone at 192.168.x.x,
  // where a bare crypto.randomUUID() call throws before any request is
  // sent. The fallback must produce a usable, unique-enough string instead.
  it('falls back to a non-cryptographic key when crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {});
    const key = newIdempotencyKey();
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
    expect(newIdempotencyKey()).not.toBe(key);
  });
});

describe('idempotency-key parameter (retry-safety)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Defect: confirmAssistantChecklist (and startVisaRenewal,
  // createProfessionalReview, transitionProfessionalReview) used to call
  // crypto.randomUUID() inside the function body, so every attempt — including
  // a retry of the exact same logical action after a lost response — sent a
  // different idempotency-key and the server created a duplicate. The key is
  // now an explicit parameter, so a caller can supply the same key twice.
  it('sends the caller-supplied idempotency key rather than generating its own', async () => {
    const fetchMock = vi.fn(
      async (..._args: [string, RequestInit]) =>
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await confirmAssistantChecklist('case-1', ['item-a'], 'stable-retry-key');
    await confirmAssistantChecklist('case-1', ['item-a'], 'stable-retry-key');

    const headersUsed = fetchMock.mock.calls.map(
      (call) => (call[1] as RequestInit).headers as Record<string, string>,
    );
    expect(headersUsed[0]!['idempotency-key']).toBe('stable-retry-key');
    expect(headersUsed[1]!['idempotency-key']).toBe('stable-retry-key');
  });

  it('still works with no key supplied, defaulting to a fresh one each call', async () => {
    const fetchMock = vi.fn(
      async (..._args: [string, RequestInit]) =>
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await confirmAssistantChecklist('case-1', ['item-a']);
    await confirmAssistantChecklist('case-1', ['item-a']);

    const headersUsed = fetchMock.mock.calls.map(
      (call) => (call[1] as RequestInit).headers as Record<string, string>,
    );
    expect(headersUsed[0]!['idempotency-key']).not.toBe(headersUsed[1]!['idempotency-key']);
  });
});

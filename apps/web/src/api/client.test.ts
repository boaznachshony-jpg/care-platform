import { afterEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn(async () => ({
  data: { session: { access_token: 'verified-user-access-token' } },
}));

vi.mock('../auth/client.js', () => ({
  getBrowserAuthClient: () => ({ auth: { getSession } }),
}));

import { listEmploymentCases, prewarmApi, resetApiPrewarmForTests } from './client.js';

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

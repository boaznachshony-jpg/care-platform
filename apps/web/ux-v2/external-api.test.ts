// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEV_TOKEN } from '../../api/src/container.js';
import { createExternalPreviewApi } from './external-api.js';
import { externalPreviewOrigins, isExternalUxPreview } from './external-policy.js';
import { externalPreviewAuthPlugin } from './external-auth-plugin.js';
import { readFile } from 'node:fs/promises';

const preview = {
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'feature/caredesk-ux-v2',
  VERCEL_URL: 'care-platform-web-review123-boaznachshony-4103s-projects.vercel.app',
  VERCEL_BRANCH_URL: 'care-platform-web-git-featu-536bb2-boaznachshony-4103s-projects.vercel.app',
};
const auth = { authorization: `Bearer ${DEV_TOKEN}` };

afterEach(() => vi.unstubAllGlobals());

describe('external UX preview isolation', () => {
  it.each([
    { ...preview, VERCEL_ENV: 'production' },
    { ...preview, VERCEL_GIT_COMMIT_REF: 'main' },
    { ...preview, VERCEL_GIT_COMMIT_REF: 'another-feature' },
    {},
  ])('never enables the demo outside its preview branch: %j', (source) => {
    expect(isExternalUxPreview(source)).toBe(false);
    expect(() => externalPreviewOrigins(source)).toThrow('preview branch');
  });

  it.each(['care-platform-web.vercel.app', 'caredesk-isr.com', 'https://example.test', ''])(
    'rejects a production or unrecognized host: %s',
    (host) => {
      expect(() => externalPreviewOrigins({ ...preview, VERCEL_URL: host })).toThrow(
        'preview hosts',
      );
    },
  );

  it('embeds only the exact deployment and branch origins', () => {
    expect(externalPreviewOrigins(preview)).toEqual([
      `https://${preview.VERCEL_URL}`,
      `https://${preview.VERCEL_BRANCH_URL}`,
    ]);
  });

  it('uses real task and medication handlers with no inherited external services', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('The preview attempted an upstream request.');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const app = await createExternalPreviewApi({
      ...preview,
      DATABASE_URL: 'postgres://production:secret@production.invalid/customer',
      SUPABASE_URL: 'https://production.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'synthetic-never-used-key',
      RESEND_API_KEY: 'synthetic-never-used-key',
      BILLING_PROVIDER: 'cardcom',
      AI_PROVIDER: 'openai',
    });
    try {
      expect((await app.inject({ url: '/cases' })).statusCode).toBe(401);
      const cases = await app.inject({ url: '/cases', headers: auth });
      const caseId = cases.json()[0].id as string;
      const created = await app.inject({
        method: 'POST',
        url: `/cases/${caseId}/tasks`,
        headers: auth,
        payload: { title: 'Synthetic external review task' },
      });
      expect(created.statusCode).toBe(201);
      const completed = await app.inject({
        method: 'POST',
        url: `/cases/${caseId}/tasks/${created.json().id}/complete`,
        headers: auth,
      });
      expect(completed.json().status).toBe('completed');
      const medication = await app.inject({
        method: 'POST',
        url: `/cases/${caseId}/medications`,
        headers: auth,
        payload: {
          name: 'Synthetic external review medication',
          dosage: '1 tablet',
          timesOfDay: ['morning'],
          daily: true,
        },
      });
      expect(medication.statusCode).toBe(201);
      expect(
        (await app.inject({ url: `/cases/${caseId}/medications`, headers: auth })).json(),
      ).toHaveLength(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('applies the local demo session adapter only to the original auth module', async () => {
    const plugin = externalPreviewAuthPlugin();
    const transform = plugin.transform;
    if (typeof transform !== 'function') throw new Error('Missing preview transform.');
    const source = await readFile(new URL('../src/auth/auth-context.tsx', import.meta.url), 'utf8');
    const invoke = (id: string) => Reflect.apply(transform, {}, [source, id]);
    expect(invoke('/src/App.tsx')).toBeUndefined();
    expect(invoke('/src/auth/auth-context.tsx')).toContain(
      "resolveAuthGateState(Boolean(client), 'local')",
    );
    expect(source).toContain('resolveAuthGateState(Boolean(client));');
  });
});

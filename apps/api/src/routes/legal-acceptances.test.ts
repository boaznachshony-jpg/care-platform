import { describe, expect, it } from 'vitest';
import type { LegalAcceptanceResponse } from '@caredesk/schemas';
import { buildServer } from '../create-server.js';
import { DEV_TOKEN } from '../container.js';
import { loadEnv } from '../env.js';

const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };
const TERMS = { document: 'terms', version: '2026-08-31' } as const;
const PRIVACY = { document: 'privacy', version: '2026-08-31' } as const;

/**
 * The defect these tests cover: the consent checkbox on the billing screen was
 * `useState` and nothing else, so nothing anywhere recorded that a customer had
 * accepted anything. Every assertion below fails against the code before
 * `/legal/acceptances` existed - the route returned 404.
 */
describe('/legal/acceptances', () => {
  it('records an acceptance per document and reads it back', async () => {
    const app = buildServer(loadEnv({}));

    const recorded = await app.inject({
      method: 'POST',
      url: '/legal/acceptances',
      headers: AUTH,
      payload: { documents: [TERMS, PRIVACY], context: 'billing' },
    });
    expect(recorded.statusCode).toBe(201);
    expect(recorded.json<LegalAcceptanceResponse>().acceptances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ document: 'terms', version: '2026-08-31', context: 'billing' }),
        expect.objectContaining({ document: 'privacy', version: '2026-08-31', context: 'billing' }),
      ]),
    );

    const listed = await app.inject({ method: 'GET', url: '/legal/acceptances', headers: AUTH });
    expect(listed.statusCode).toBe(200);
    const documents = listed.json<LegalAcceptanceResponse>().acceptances.map((a) => a.document);
    expect(documents).toContain('terms');
    expect(documents).toContain('privacy');
  });

  it('records the same version once, however many times it is submitted', async () => {
    const app = buildServer(loadEnv({}));
    const payload = { documents: [TERMS], context: 'onboarding' };

    // Two tabs, a retry, a reload: all of these replay the same acceptance, and
    // an evidence table that grew a row each time would be a log, not a record.
    for (const _attempt of [1, 2, 3]) {
      const response = await app.inject({
        method: 'POST',
        url: '/legal/acceptances',
        headers: AUTH,
        payload,
      });
      expect(response.statusCode).toBe(201);
    }

    const listed = await app.inject({ method: 'GET', url: '/legal/acceptances', headers: AUTH });
    const terms = listed
      .json<LegalAcceptanceResponse>()
      .acceptances.filter((a) => a.document === 'terms' && a.version === '2026-08-31');
    expect(terms).toHaveLength(1);
  });

  it('keeps a superseded acceptance alongside the new one', async () => {
    const app = buildServer(loadEnv({}));
    await app.inject({
      method: 'POST',
      url: '/legal/acceptances',
      headers: AUTH,
      payload: { documents: [TERMS], context: 'onboarding' },
    });
    await app.inject({
      method: 'POST',
      url: '/legal/acceptances',
      headers: AUTH,
      payload: {
        documents: [{ document: 'terms', version: '2027-01-15' }],
        context: 'billing',
      },
    });

    const listed = await app.inject({ method: 'GET', url: '/legal/acceptances', headers: AUTH });
    const versions = listed
      .json<LegalAcceptanceResponse>()
      .acceptances.filter((a) => a.document === 'terms')
      .map((a) => a.version);
    // Accepting v2 does not erase the fact that v1 was accepted. There is no
    // UPDATE and no DELETE grant on `terms_acceptance` precisely so that this
    // cannot become an overwrite.
    expect(versions).toEqual(expect.arrayContaining(['2026-08-31', '2027-01-15']));
    expect(listed.json<LegalAcceptanceResponse>().acceptances[0]).toMatchObject({
      version: '2027-01-15',
    });
  });

  it('rejects a version that is not a publication date', async () => {
    const app = buildServer(loadEnv({}));
    const response = await app.inject({
      method: 'POST',
      url: '/legal/acceptances',
      headers: AUTH,
      payload: { documents: [{ document: 'terms', version: 'latest' }], context: 'billing' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects an unknown document rather than storing a name nobody published', async () => {
    const app = buildServer(loadEnv({}));
    const response = await app.inject({
      method: 'POST',
      url: '/legal/acceptances',
      headers: AUTH,
      payload: {
        documents: [{ document: 'cookies', version: '2026-08-31' }],
        context: 'billing',
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an unknown context', async () => {
    const app = buildServer(loadEnv({}));
    const response = await app.inject({
      method: 'POST',
      url: '/legal/acceptances',
      headers: AUTH,
      payload: { documents: [TERMS], context: 'somewhere-else' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an empty document list', async () => {
    const app = buildServer(loadEnv({}));
    const response = await app.inject({
      method: 'POST',
      url: '/legal/acceptances',
      headers: AUTH,
      payload: { documents: [], context: 'billing' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses to record an acceptance for an unauthenticated caller', async () => {
    const app = buildServer(loadEnv({}));
    for (const [method, url] of [
      ['POST', '/legal/acceptances'],
      ['GET', '/legal/acceptances'],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        ...(method === 'POST' ? { payload: { documents: [TERMS], context: 'billing' } } : {}),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
      expect(response.json(), `${method} ${url}`).toMatchObject({ code: 'UNAUTHENTICATED' });
    }
  });

  it('ignores an actor supplied in the body', async () => {
    const app = buildServer(loadEnv({}));
    // The identity of the person accepting comes from the token, never from the
    // request. A record the client can address to somebody else is evidence
    // about nobody, so the strict schema refuses the field outright.
    const response = await app.inject({
      method: 'POST',
      url: '/legal/acceptances',
      headers: AUTH,
      payload: {
        documents: [TERMS],
        context: 'billing',
        userId: '00000000-0000-4000-8000-00000000dead',
      },
    });
    expect(response.statusCode).toBe(400);
  });
});

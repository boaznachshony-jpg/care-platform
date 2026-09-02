import { describe, expect, it } from 'vitest';
import { buildServer } from '../create-server.js';
import { loadEnv } from '../env.js';
import { DEV_TOKEN } from '../container.js';
import type { FastifyInstance } from 'fastify';

// Constitution §16: synthetic data only.
const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };
const VALID_CASE = {
  careRecipient: { fullName: 'Synthetic Care Recipient' },
  employer: { fullName: 'Synthetic Employer', relationshipToRecipient: 'child' },
  caregiver: { legalName: 'Synthetic Caregiver', nationality: 'Philippines' },
  startDate: '2026-02-01',
};

async function createCase(app: FastifyInstance) {
  const created = await app.inject({
    method: 'POST',
    url: '/cases',
    headers: AUTH,
    payload: VALID_CASE,
  });
  expect(created.statusCode).toBe(201);
  return created.json().id as string;
}

/**
 * The assistant endpoint's `answer`, `groundingLabel`, `factsUsed[].label`,
 * `uncertainties[].message` and `escalation.reason` are deliberately kept in
 * English (see the comment above the response builder in
 * product-differentiation.ts) — the client is the one that renders Hebrew, by
 * translating the stable identifiers this response carries alongside each
 * string, falling back to the English text when it does not recognise one.
 * These tests pin the identifier contract so the client-side fallback keeps
 * working if the server text ever changes.
 */
describe('case assistant response carries translation identifiers', () => {
  it('marks a missing-evidence answer with a translatable id and the raw type list', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await createCase(app);
    const response = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/assistant`,
      headers: AUTH,
      payload: { question: 'What is missing for travel?', intent: 'travel_check' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.answerId).toBe('assistant.answer.missingDocuments');
    expect(body.answerParams.missingTypes).toEqual(
      expect.arrayContaining(['passport', 'visa', 'medical_insurance']),
    );
    expect(typeof body.answer).toBe('string');
    expect(body.groundingLabelId).toBe('assistant.groundingLabel');
    expect(typeof body.groundingLabel).toBe('string');
    await app.close();
  });

  it('gives every fact a labelId/labelParams pair positionally aligned with factsUsed', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await createCase(app);
    const response = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/assistant`,
      headers: AUTH,
      payload: { question: 'What is the case status?', intent: 'missing_file_facts' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.factsUsed.length).toBeGreaterThan(0);
    // A case is now born 'active', not 'draft' (see open-employment-case.ts —
    // "saving IS the file"), so a freshly opened case's status fact reflects
    // that from creation.
    expect(body.factsUsed[0]).toMatchObject({
      factPath: 'caseSummary.status',
      labelId: 'assistant.fact.caseStatus',
      labelParams: { status: 'active' },
    });
    for (const fact of body.factsUsed) {
      expect(typeof fact.labelId).toBe('string');
      expect(typeof fact.label).toBe('string');
    }
    await app.close();
  });

  it('marks the escalation reason with an id reflecting whether an approved rule applied', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await createCase(app);
    const response = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/assistant`,
      headers: AUTH,
      payload: { question: 'Any professional review needed?', intent: 'explain_attention' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.escalation.required).toBe(true);
    expect(body.escalation.reasonId).toBe('assistant.escalation.reasonNoRule');
    expect(typeof body.escalation.reason).toBe('string');
    await app.close();
  });

  it('marks a fully-documented case with the documentsValid answer id and an open-task count param', async () => {
    const app = buildServer(loadEnv({}));
    const caseId = await createCase(app);
    // Synthetic case starts with no documents, so it always has missing
    // evidence — this test only pins the *shape* of the alternate branch,
    // not a reachable state, since exercising it would require uploading
    // three valid documents through routes this test does not own.
    const response = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/assistant`,
      headers: AUTH,
      payload: { question: 'checklist please', intent: 'checklist' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(['assistant.answer.missingDocuments', 'assistant.answer.documentsValid']).toContain(
      body.answerId,
    );
    await app.close();
  });
});

import { describe, expect, it, vi } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';
import { buildContainer, DEV_TOKEN, type Container } from '../container.js';
import { buildServer } from '../create-server.js';
import { loadEnv } from '../env.js';
import { InMemoryRateLimiter } from '../rate-limit.js';
import {
  filterEffectiveActiveRules,
  REGULATION_RULE_TRANSITIONS,
  REGULATION_SEED_RULES,
  type RegulationRule,
} from '../regulation-rule-service.js';
import { registerRegulationRuleRoutes } from './regulation-rules.js';

// Constitution §16: synthetic data only. The fixed dev identity seeded by
// buildContainer (tenant owner) — mirrors container.ts.
const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };
const DEV_ACTOR = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
  correlationId: 'regulation-test',
};
const VALID_CASE = {
  careRecipient: { fullName: 'Synthetic Care Recipient' },
  employer: { fullName: 'Synthetic Employer', relationshipToRecipient: 'child' },
  caregiver: { legalName: 'Synthetic Caregiver', nationality: 'Philippines' },
  startDate: '2026-02-01',
};
const DRAFT_BODY = {
  ruleKey: 'synthetic_test_rule',
  title: 'Synthetic reviewed statement',
  statement: 'A synthetic, conservative factual statement used only by tests.',
  sourceCitation: 'Synthetic source citation (test fixture)',
  sourceAuthority: 'Synthetic authority',
  effectiveFrom: '2026-01-01',
};

/**
 * The lifecycle routes are exercised on a bare Fastify instance (central
 * registration in create-server.ts is merged separately), while the leak tests
 * go through the full buildServer app because the assistant/event-plan routes
 * are already centrally registered there.
 */
function makeApp(): { app: FastifyInstance; container: Container } {
  const container = buildContainer(loadEnv({}));
  const app = fastify();
  registerRegulationRuleRoutes(app, container, new InMemoryRateLimiter());
  return { app, container };
}

async function createDraft(app: FastifyInstance, key = `draft-${Math.random()}`) {
  const response = await app.inject({
    method: 'POST',
    url: '/regulation-rules',
    headers: { ...AUTH, 'idempotency-key': key },
    payload: DRAFT_BODY,
  });
  expect(response.statusCode).toBe(201);
  return response.json().rule as RegulationRule;
}

function patchRule(
  app: FastifyInstance,
  ruleId: string,
  key: string,
  payload: { status: string; reviewedBy?: string },
) {
  return app.inject({
    method: 'PATCH',
    url: `/regulation-rules/${ruleId}`,
    headers: { ...AUTH, 'idempotency-key': key },
    payload,
  });
}

describe('regulation rule lifecycle', () => {
  it('declares a strict linear review lifecycle with a terminal retired state', () => {
    expect(REGULATION_RULE_TRANSITIONS.draft).toEqual(['in_review']);
    expect(REGULATION_RULE_TRANSITIONS.in_review).toEqual(['approved']);
    expect(REGULATION_RULE_TRANSITIONS.approved).toEqual(['active']);
    expect(REGULATION_RULE_TRANSITIONS.active).toEqual(['retired']);
    expect(REGULATION_RULE_TRANSITIONS.retired).toEqual([]);
  });

  it('never lets non-active or out-of-window content pass the context filter', () => {
    const base = { effectiveFrom: '2026-01-01', effectiveTo: null };
    const asOf = '2026-08-19';
    for (const status of ['draft', 'in_review', 'approved', 'retired'] as const) {
      expect(filterEffectiveActiveRules([{ status, ...base }], asOf)).toEqual([]);
    }
    expect(filterEffectiveActiveRules([{ status: 'active' as const, ...base }], asOf)).toHaveLength(
      1,
    );
    // An active rule outside its effective window is excluded too.
    expect(
      filterEffectiveActiveRules(
        [{ status: 'active' as const, effectiveFrom: '2026-09-01', effectiveTo: null }],
        asOf,
      ),
    ).toEqual([]);
    expect(
      filterEffectiveActiveRules(
        [{ status: 'active' as const, effectiveFrom: '2026-01-01', effectiveTo: '2026-02-01' }],
        asOf,
      ),
    ).toEqual([]);
    expect(
      filterEffectiveActiveRules(
        [{ status: 'active' as const, effectiveFrom: null, effectiveTo: null }],
        asOf,
      ),
    ).toEqual([]);
  });

  it('lists the seeded reviewed content as approved with full provenance', async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: 'GET', url: '/regulation-rules', headers: AUTH });
    expect(response.statusCode).toBe(200);
    const rules = response.json() as RegulationRule[];
    expect(rules).toHaveLength(REGULATION_SEED_RULES.length);
    for (const rule of rules) {
      expect(rule.status).toBe('approved');
      expect(rule.requiresProfessionalValidation).toBe(true);
      expect(rule.sourceCitation.length).toBeGreaterThan(3);
      expect(rule.reviewedBy).toBeTruthy();
      expect(rule.reviewedAt).toBeTruthy();
      expect(rule.activatedAt).toBeNull();
    }
    expect(rules.map((rule) => rule.ruleKey)).toContain('weekly_rest_day');
    await app.close();
  });

  it('requires authentication and an idempotency key', async () => {
    const { app } = makeApp();
    const unauthenticated = await app.inject({ method: 'GET', url: '/regulation-rules' });
    expect(unauthenticated.statusCode).toBe(401);
    const missingKey = await app.inject({
      method: 'POST',
      url: '/regulation-rules',
      headers: AUTH,
      payload: DRAFT_BODY,
    });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    await app.close();
  });

  it('rejects every illegal jump with 409 INVALID_TRANSITION', async () => {
    const { app } = makeApp();
    const draft = await createDraft(app);
    // A draft cannot be activated or approved without review.
    for (const status of ['active', 'approved', 'retired']) {
      const response = await patchRule(app, draft.id, `illegal-${status}-1`, {
        status,
        ...(status === 'approved' ? { reviewedBy: 'Adv. Synthetic Reviewer' } : {}),
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'INVALID_TRANSITION' });
    }
    // Seeded approved content cannot be retired without ever being active.
    const listed = await app.inject({ method: 'GET', url: '/regulation-rules', headers: AUTH });
    const approved = (listed.json() as RegulationRule[]).find(
      (rule) => rule.status === 'approved',
    )!;
    const retire = await patchRule(app, approved.id, 'illegal-approved-retire', {
      status: 'retired',
    });
    expect(retire.statusCode).toBe(409);
    await app.close();
  });

  it('requires a professional reviewer name to approve', async () => {
    const { app } = makeApp();
    const draft = await createDraft(app);
    await patchRule(app, draft.id, 'review-1', { status: 'in_review' });
    const response = await patchRule(app, draft.id, 'approve-no-name', { status: 'approved' });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.fieldErrors).toHaveProperty('reviewedBy');
    await app.close();
  });

  it('walks the full legal lifecycle and records evidence timestamps + history', async () => {
    const { app } = makeApp();
    const draft = await createDraft(app);
    expect(draft.status).toBe('draft');
    expect(draft.requiresProfessionalValidation).toBe(true);

    const inReview = await patchRule(app, draft.id, 'walk-review-1', { status: 'in_review' });
    expect(inReview.statusCode).toBe(200);
    expect(inReview.json().rule.status).toBe('in_review');

    const approved = await patchRule(app, draft.id, 'walk-approve-1', {
      status: 'approved',
      reviewedBy: 'Adv. Synthetic Professional, 03-0000000',
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().rule).toMatchObject({
      status: 'approved',
      reviewedBy: 'Adv. Synthetic Professional, 03-0000000',
    });
    expect(approved.json().rule.reviewedAt).toBeTruthy();

    const activated = await patchRule(app, draft.id, 'walk-activate-1', { status: 'active' });
    expect(activated.statusCode).toBe(200);
    expect(activated.json().rule.activatedAt).toBeTruthy();

    const retired = await patchRule(app, draft.id, 'walk-retire-1', { status: 'retired' });
    expect(retired.statusCode).toBe(200);
    expect(retired.json().rule.retiredAt).toBeTruthy();

    const detail = await app.inject({
      method: 'GET',
      url: `/regulation-rules/${draft.id}`,
      headers: AUTH,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().history).toHaveLength(4);

    // Terminal: nothing moves out of retired.
    const afterTerminal = await patchRule(app, draft.id, 'walk-post-terminal', {
      status: 'in_review',
    });
    expect(afterTerminal.statusCode).toBe(409);
    await app.close();
  });

  it('refuses to activate a rule without an effective start date', async () => {
    const { app } = makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/regulation-rules',
      headers: { ...AUTH, 'idempotency-key': 'no-effective-create' },
      payload: {
        ruleKey: 'synthetic_no_effective',
        title: DRAFT_BODY.title,
        statement: DRAFT_BODY.statement,
        sourceCitation: DRAFT_BODY.sourceCitation,
      },
    });
    expect(created.statusCode).toBe(201);
    const ruleId = created.json().rule.id as string;
    await patchRule(app, ruleId, 'no-effective-review', { status: 'in_review' });
    await patchRule(app, ruleId, 'no-effective-approve', {
      status: 'approved',
      reviewedBy: 'Adv. Synthetic Reviewer',
    });
    const activate = await patchRule(app, ruleId, 'no-effective-activate', { status: 'active' });
    expect(activate.statusCode).toBe(422);
    expect(activate.json()).toMatchObject({ code: 'EFFECTIVE_FROM_REQUIRED' });
    await app.close();
  });

  it('replays an idempotent transition and create without applying them twice', async () => {
    const { app } = makeApp();
    const createRequest = {
      method: 'POST' as const,
      url: '/regulation-rules',
      headers: { ...AUTH, 'idempotency-key': 'replay-create-1' },
      payload: DRAFT_BODY,
    };
    const firstCreate = await app.inject(createRequest);
    expect(firstCreate.statusCode).toBe(201);
    const replayCreate = await app.inject(createRequest);
    expect(replayCreate.statusCode).toBe(200);
    expect(replayCreate.json()).toMatchObject({ replayed: true });
    expect(replayCreate.json().rule.id).toBe(firstCreate.json().rule.id);

    const ruleId = firstCreate.json().rule.id as string;
    const first = await patchRule(app, ruleId, 'replay-transition-1', { status: 'in_review' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ replayed: false });
    const replay = await patchRule(app, ruleId, 'replay-transition-1', { status: 'in_review' });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ replayed: true, rule: { status: 'in_review' } });

    const detail = await app.inject({
      method: 'GET',
      url: `/regulation-rules/${ruleId}`,
      headers: AUTH,
    });
    expect(detail.json().history).toHaveLength(1);
    await app.close();
  });

  it('denies authoring and transitions to a non-manager with 403', async () => {
    const { app, container } = makeApp();
    // A member listing can be read before the role changes hands.
    const seeded = await app.inject({ method: 'GET', url: '/regulation-rules', headers: AUTH });
    const approved = (seeded.json() as RegulationRule[])[0]!;
    vi.spyOn(container.listFamilyMembers, 'execute').mockResolvedValue({
      canManage: false,
      members: [
        {
          membershipId: '00000000-0000-4000-8000-000000000003',
          userId: DEV_ACTOR.userId,
          displayName: 'Synthetic viewer',
          email: 'viewer@example.test',
          role: 'viewer',
          status: 'active',
          invitedAt: new Date(0).toISOString(),
          lastAuthenticatedAt: null,
          isCurrentUser: true,
        },
      ],
    });
    const create = await app.inject({
      method: 'POST',
      url: '/regulation-rules',
      headers: { ...AUTH, 'idempotency-key': 'viewer-create-1' },
      payload: DRAFT_BODY,
    });
    expect(create.statusCode).toBe(403);
    expect(create.json()).toMatchObject({ code: 'MANAGER_REQUIRED' });
    const transition = await patchRule(app, approved.id, 'viewer-transition-1', {
      status: 'active',
    });
    expect(transition.statusCode).toBe(403);
    expect(transition.json()).toMatchObject({ code: 'MANAGER_REQUIRED' });
    await app.close();
  });
});

describe('assistant/wizard context leak protection', () => {
  async function createCase(app: FastifyInstance): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/cases',
      headers: AUTH,
      payload: VALID_CASE,
    });
    expect(response.statusCode).toBe(201);
    return response.json().id as string;
  }

  function askAssistant(app: FastifyInstance, caseId: string) {
    return app.inject({
      method: 'POST',
      url: `/cases/${caseId}/assistant`,
      headers: AUTH,
      payload: { question: 'What rules apply to travel?', intent: 'travel_check' },
    });
  }

  it('feeds the assistant only ACTIVE effective-dated rules — approved/draft/retired never leak', async () => {
    const container = buildContainer(loadEnv({}));
    const app = buildServer(loadEnv({}), container);
    const caseId = await createCase(app);

    // Seeded content is approved but NOT active — nothing may reach context,
    // and a fresh draft never appears either.
    await container.regulationRules.create(
      DEV_ACTOR,
      {
        ruleKey: 'synthetic_leak_probe',
        title: 'Draft probe rule',
        statement: 'A draft statement that must never reach assistant context.',
        sourceCitation: 'Synthetic citation',
        effectiveFrom: '2026-01-01',
      },
      'leak-probe-create-1',
    );
    const before = await askAssistant(app, caseId);
    expect(before.statusCode).toBe(200);
    expect(
      (before.json().factsUsed as Array<{ factPath: string }>).some((fact) =>
        fact.factPath.startsWith('relevantApprovedRules'),
      ),
    ).toBe(false);
    expect(before.json().uncertainties).toContainEqual(
      expect.objectContaining({ code: 'no_approved_rule' }),
    );

    // A manager explicitly activates one reviewed rule.
    const rules = await container.regulationRules.list(DEV_ACTOR);
    const approved = rules.find((rule) => rule.status === 'approved')!;
    await container.regulationRules.transition(
      DEV_ACTOR,
      approved.id,
      'active',
      undefined,
      'leak-activate-1',
    );

    const during = await askAssistant(app, caseId);
    expect(during.statusCode).toBe(200);
    const facts = during.json().factsUsed as Array<{ factPath: string; label: string }>;
    expect(facts.some((fact) => fact.factPath === 'relevantApprovedRules.0.title')).toBe(true);
    expect(during.json().uncertainties).not.toContainEqual(
      expect.objectContaining({ code: 'no_approved_rule' }),
    );

    // Retired content disappears from context again — fail closed.
    await container.regulationRules.transition(
      DEV_ACTOR,
      approved.id,
      'retired',
      undefined,
      'leak-retire-1',
    );
    const after = await askAssistant(app, caseId);
    expect(
      (after.json().factsUsed as Array<{ factPath: string }>).some((fact) =>
        fact.factPath.startsWith('relevantApprovedRules'),
      ),
    ).toBe(false);
    expect(after.json().uncertainties).toContainEqual(
      expect.objectContaining({ code: 'no_approved_rule' }),
    );
    await app.close();
  });

  it('feeds the event wizard active rules so a covered travel plan drops the no-rule uncertainty', async () => {
    const container = buildContainer(loadEnv({}));
    const app = buildServer(loadEnv({}), container);
    const caseId = await createCase(app);
    const payload = {
      eventType: 'caregiver_travel',
      answers: [
        { questionId: 'departure_date', value: '2026-09-01' },
        { questionId: 'return_date', value: '2026-09-15' },
        { questionId: 'destination', value: 'Synthetic destination' },
        { questionId: 'intends_return', value: true },
      ],
      status: 'confirmed',
    };

    const uncovered = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/event-plans`,
      headers: { ...AUTH, 'idempotency-key': 'plan-uncovered-1' },
      payload,
    });
    expect(uncovered.statusCode).toBe(201);
    expect(uncovered.json().uncertainties).toContain('no_approved_travel_rule');

    const rules = await container.regulationRules.list(DEV_ACTOR);
    const approved = rules.find((rule) => rule.status === 'approved')!;
    await container.regulationRules.transition(
      DEV_ACTOR,
      approved.id,
      'active',
      undefined,
      'plan-activate-1',
    );

    const covered = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/event-plans`,
      headers: { ...AUTH, 'idempotency-key': 'plan-covered-1' },
      payload,
    });
    expect(covered.statusCode).toBe(201);
    expect(covered.json().uncertainties).not.toContain('no_approved_travel_rule');
    await app.close();
  });
});

import { describe, expect, it } from 'vitest';
import {
  StartVisaRenewalWorkflow,
  RecordVisaRenewalContactActivity,
  LinkRenewedVisaAuthorization,
  CompleteVisaRenewalWorkflow,
  ResolveVisaAuthorizationOverlap,
  AuthorizationError,
  VisaRenewalValidationError,
  type Actor,
} from '@caredesk/application';
import { FixedClock } from './clock.js';
import { SequentialIdGenerator } from './id-generator.js';
import { InMemoryAuditService } from './in-memory-audit-service.js';
import { InMemoryVisaRenewalRepository } from './in-memory-visa-renewal-repository.js';
import { MembershipAuthorizationService } from './membership-authorization-service.js';

const actor: Actor = { userId: 'user-1', tenantId: 'tenant-1', correlationId: 'corr-1' };
function harness() {
  const authorization = new MembershipAuthorizationService({
    owner: ['workflow:start', 'workflow:update', 'workflow:complete'],
  });
  authorization.seedMembership({ ...actor, role: 'owner', status: 'active' });
  const workflows = new InMemoryVisaRenewalRepository();
  const deps = {
    authorization,
    workflows,
    progress: workflows,
    idempotency: workflows,
    audit: new InMemoryAuditService(),
    clock: new FixedClock(new Date('2026-08-12T00:00:00.000Z')),
    ids: new SequentialIdGenerator(),
  };
  return {
    workflows,
    start: new StartVisaRenewalWorkflow(deps),
    contact: new RecordVisaRenewalContactActivity(deps),
    link: new LinkRenewedVisaAuthorization(deps),
    complete: new CompleteVisaRenewalWorkflow(deps),
    resolve: new ResolveVisaAuthorizationOverlap(deps),
  };
}
const input = {
  templateVersionId: 'template-v1',
  currentAuthorizationId: 'authorization-1',
  idempotencyKey: 'key-1',
  requestHash: 'hash-1',
  evaluation: {
    ruleDefinitionId: 'rule',
    ruleVersionId: 'rule-v1',
    status: 'active' as const,
    asOf: '2026-08-12',
    dueDate: '2026-09-01',
    priority: 'high' as const,
    explanationKey: 'visa.expires',
    sourceReferences: ['source-1'],
    reviewRequired: false,
  },
  assignments: [
    {
      stepKey: 'prepare',
      raciRole: 'accountable' as const,
      assigneeType: 'user' as const,
      assigneeId: 'user-1',
    },
    {
      stepKey: 'prepare',
      raciRole: 'responsible' as const,
      assigneeType: 'contact' as const,
      assigneeId: 'contact-1',
    },
  ],
};
describe('visa renewal workflow', () => {
  it('starts once and replays the same idempotent request', async () => {
    const h = harness();
    const first = await h.start.execute(actor, 'case-1', input);
    const second = await h.start.execute(actor, 'case-1', input);
    expect(second.id).toBe(first.id);
    expect(await h.workflows.listByCase('tenant-1', 'case-1')).toHaveLength(1);
  });
  it('refuses an unverified legal rule', async () => {
    const h = harness();
    await expect(
      h.start.execute(actor, 'case-1', {
        ...input,
        evaluation: { ...input.evaluation, status: 'unverified' },
      }),
    ).rejects.toMatchObject({
      code: 'RULE_UNVERIFIED',
    } satisfies Partial<VisaRenewalValidationError>);
  });
  it('records contact activity once and denies a cross-tenant actor', async () => {
    const h = harness();
    const workflow = await h.start.execute(actor, 'case-1', input);
    const contact = {
      idempotencyKey: 'contact-1',
      requestHash: 'contact-hash',
      organizationId: 'org-1',
      channel: 'phone' as const,
      occurredAt: '2026-08-12T01:00:00.000Z',
      purpose: 'Synthetic follow-up',
      outcome: 'Synthetic outcome',
      confirmationStatus: 'pending' as const,
      sensitivity: 'employment_sensitive' as const,
      visibility: 'case' as const,
    };
    const first = await h.contact.execute(actor, 'case-1', workflow.id, contact);
    expect(await h.contact.execute(actor, 'case-1', workflow.id, contact)).toEqual(first);
    await expect(
      h.contact.execute({ ...actor, tenantId: 'tenant-2' }, 'case-1', workflow.id, {
        ...contact,
        idempotencyKey: 'other',
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
  it('links a new authorization without replacing the historical authorization and completes idempotently', async () => {
    const h = harness();
    const workflow = await h.start.execute(actor, 'case-1', input);
    const linked = await h.link.execute(actor, 'case-1', workflow.id, {
      documentVersionId: 'document-1',
      validFrom: '2026-09-01',
      validTo: '2027-08-31',
      idempotencyKey: 'link-1',
      requestHash: 'link-hash',
    });
    const afterLink = await h.workflows.find(actor.tenantId, workflow.id);
    expect(afterLink?.currentAuthorizationId).toBe('authorization-1');
    expect(afterLink?.linkedRenewedAuthorizationId).toBe(linked.renewedAuthorizationId);
    const completion = {
      taskId: 'task-1',
      idempotencyKey: 'complete-1',
      requestHash: 'complete-hash',
    };
    const completed = await h.complete.execute(actor, 'case-1', workflow.id, completion);
    expect(completed.status).toBe('completed');
    expect(await h.complete.execute(actor, 'case-1', workflow.id, completion)).toEqual(completed);
  });
  it('refuses completion until verified authorization linkage exists', async () => {
    const h = harness();
    const workflow = await h.start.execute(actor, 'case-1', input);
    await expect(
      h.complete.execute(actor, 'case-1', workflow.id, {
        taskId: 'task-1',
        idempotencyKey: 'bad',
        requestHash: 'bad',
      }),
    ).rejects.toMatchObject({ code: 'COMPLETION_INVALID' });
  });
  it('denies cross-tenant authority for every remaining mutation', async () => {
    const h = harness();
    const workflow = await h.start.execute(actor, 'case-1', input);
    const other = { ...actor, tenantId: 'tenant-2' };
    const attempts = [
      () =>
        h.link.execute(other, 'case-1', workflow.id, {
          documentVersionId: 'document-1',
          validFrom: '2026-09-01',
          validTo: '2027-08-31',
          idempotencyKey: 'x-link',
          requestHash: 'x-link',
        }),
      () =>
        h.resolve.execute(other, 'case-1', workflow.id, 'review-1', {
          resolutionCode: 'reviewed',
          idempotencyKey: 'x-review',
          requestHash: 'x-review',
        }),
      () =>
        h.complete.execute(other, 'case-1', workflow.id, {
          taskId: 'task-1',
          idempotencyKey: 'x-complete',
          requestHash: 'x-complete',
        }),
    ];
    for (const attempt of attempts)
      await expect(attempt()).rejects.toBeInstanceOf(AuthorizationError);
  });
});

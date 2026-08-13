import { describe, expect, it } from 'vitest';
import {
  StartVisaRenewalWorkflow,
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
  const authorization = new MembershipAuthorizationService({ owner: ['workflow:start'] });
  authorization.seedMembership({ ...actor, role: 'owner', status: 'active' });
  const workflows = new InMemoryVisaRenewalRepository();
  return {
    workflows,
    start: new StartVisaRenewalWorkflow({
      authorization,
      workflows,
      idempotency: workflows,
      audit: new InMemoryAuditService(),
      clock: new FixedClock(new Date('2026-08-12T00:00:00.000Z')),
      ids: new SequentialIdGenerator(),
    }),
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
});

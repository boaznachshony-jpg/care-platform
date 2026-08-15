import { describe, expect, it } from 'vitest';
import {
  assertAssignableMember,
  projectSharedLeave,
  projectSharedPayments,
} from './collaboration.js';

describe('Wave 5 shared employment projections', () => {
  it('uses the same closed canonical payment facts for employer and worker', () => {
    const facts = [
      {
        closeId: 'closed',
        caseId: 'case-a',
        workerId: 'worker-a',
        month: '2026-07',
        status: 'closed' as const,
        amountPaid: 6400,
        paymentDate: '2026-08-01',
        paymentMethod: 'bank_transfer',
        evidenceAvailable: true,
      },
      {
        closeId: 'draft',
        caseId: 'case-a',
        workerId: 'worker-a',
        month: '2026-08',
        status: 'draft' as const,
        amountPaid: 0,
        evidenceAvailable: false,
      },
      {
        closeId: 'other',
        caseId: 'case-b',
        workerId: 'worker-b',
        month: '2026-07',
        status: 'closed' as const,
        amountPaid: 1,
        paymentDate: '2026-08-01',
        evidenceAvailable: false,
      },
    ];
    const employer = projectSharedPayments({ caseId: 'case-a', workerId: 'worker-a', facts });
    const worker = projectSharedPayments({ caseId: 'case-a', workerId: 'worker-a', facts });
    expect(worker).toEqual(employer);
    expect(worker.map((payment) => payment.closeId)).toEqual(['closed']);
  });

  it('projects leave without inventing statutory entitlement', () => {
    const facts = [
      {
        id: 'leave-1',
        caseId: 'case-a',
        workerId: 'worker-a',
        startDate: '2026-08-20',
        endDate: '2026-08-21',
        days: 2,
        status: 'pending' as const,
      },
    ];
    const projection = projectSharedLeave({ caseId: 'case-a', workerId: 'worker-a', facts });
    expect(projection.availableBalance).toBeNull();
    expect(projection.pending).toEqual(facts);
  });

  it('rejects viewer and cross-tenant task assignees', () => {
    expect(() =>
      assertAssignableMember({
        actorRole: 'viewer',
        tenantId: 'a',
        assigneeTenantId: 'a',
        assigneeStatus: 'active',
      }),
    ).toThrow('manager_required');
    expect(() =>
      assertAssignableMember({
        actorRole: 'manager',
        tenantId: 'a',
        assigneeTenantId: 'b',
        assigneeStatus: 'active',
      }),
    ).toThrow('invalid_assignee');
  });
});

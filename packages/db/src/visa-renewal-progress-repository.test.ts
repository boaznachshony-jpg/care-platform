import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { PgVisaRenewalProgressRepository } from './visa-renewal-repository.js';

function fakePool() {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const query = async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    return { rowCount: 1, rows: [] };
  };
  const release = () => undefined;
  const connect = async () => ({ query, release });
  return { pool: { connect } as unknown as Pool, calls };
}

const ids = {
  id: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
  employmentCaseId: '00000000-0000-4000-8000-000000000003',
  workflowId: '00000000-0000-4000-8000-000000000004',
};

describe('PgVisaRenewalProgressRepository', () => {
  it('persists all contact metadata in the append-only activity adapter', async () => {
    const db = fakePool();
    const repository = new PgVisaRenewalProgressRepository(db.pool);
    await repository.recordContactActivity({
      ...ids,
      workflowStepId: null,
      organizationId: '00000000-0000-4000-8000-000000000005',
      contactId: null,
      channel: 'letter',
      occurredAt: '2026-08-14T10:00:00.000Z',
      purpose: 'Synthetic renewal follow-up',
      outcome: 'Synthetic response recorded',
      followUpAt: '2026-08-21T10:00:00.000Z',
      confirmationStatus: 'pending',
      sensitivity: 'employment_sensitive',
      visibility: 'case',
      recordedBy: '00000000-0000-4000-8000-000000000006',
    });

    const insert = db.calls.find(({ sql }) => sql.includes('workflow_contact_activity'));
    expect(insert?.sql).toContain('follow_up_at, confirmation_status, sensitivity, visibility');
    expect(insert?.values).toContain('letter');
    expect(insert?.values).toContain('pending');
  });

  it('links only a same-case, verified document without changing old validity', async () => {
    const db = fakePool();
    const repository = new PgVisaRenewalProgressRepository(db.pool);
    await repository.linkRenewedAuthorization({
      ...ids,
      priorAuthorizationId: '00000000-0000-4000-8000-000000000005',
      renewedAuthorizationId: '00000000-0000-4000-8000-000000000006',
      documentVersionId: '00000000-0000-4000-8000-000000000007',
      validFrom: '2026-08-01',
      validUntil: '2027-07-31',
      linkedBy: '00000000-0000-4000-8000-000000000008',
      linkedAt: '2026-08-14T10:00:00.000Z',
    });

    const insert = db.calls.find(({ sql }) => sql.includes('employment_authorization_link'));
    expect(insert?.sql).toContain("dv.verification_status = 'verified'");
    expect(insert?.sql).toContain('prior.employment_case_id = $3');
    expect(insert?.sql).not.toMatch(/update employment_authorization/);
    expect(
      db.calls.some(({ sql }) => sql.includes('insert into authorization_overlap_review')),
    ).toBe(true);
    expect(db.calls.some(({ sql }) => sql.includes("ea.status in ('current','renewed')"))).toBe(
      true,
    );
    expect(
      db.calls.find(({ sql }) => sql.includes('insert into authorization_overlap_review'))?.sql,
    ).toContain('returning id');
  });

  it('resolves an overlap only inside the named case and workflow', async () => {
    const db = fakePool();
    const repository = new PgVisaRenewalProgressRepository(db.pool);
    await repository.resolveOverlapReview({
      ...ids,
      reviewId: ids.id,
      resolutionCode: 'reviewed',
      reviewedBy: '00000000-0000-4000-8000-000000000008',
      reviewedAt: '2026-08-14T10:00:00.000Z',
    });
    const update =
      db.calls.find(({ sql }) => sql.includes('update authorization_overlap_review'))?.sql ?? '';
    expect(update).toContain('employment_case_id = $6');
    expect(update).toContain('workflow_instance_id = $7');
  });

  it('completes only the linked task after steps, evidence, and reviews pass', async () => {
    const db = fakePool();
    const repository = new PgVisaRenewalProgressRepository(db.pool);
    await repository.complete({
      ...ids,
      taskId: '00000000-0000-4000-8000-000000000005',
      timelineEventId: '00000000-0000-4000-8000-000000000006',
      auditEventId: '00000000-0000-4000-8000-000000000007',
      completedBy: '00000000-0000-4000-8000-000000000008',
      completedAt: '2026-08-14T10:00:00.000Z',
      correlationId: 'synthetic-correlation',
    });

    const statement = db.calls.find(({ sql }) => sql.includes('workflow_completion'))?.sql ?? '';
    expect(statement).toContain('employment_authorization_link');
    expect(statement).toContain("dv.verification_status = 'verified'");
    expect(statement).toContain("ws.status not in ('completed', 'cancelled')");
    expect(statement).toContain("ar.status <> 'resolved'");
    expect(statement).toContain('t.workflow_instance_id = wu.id');
    expect(statement).toContain('insert into timeline_event');
    expect(statement).toContain('insert into audit_event');
  });
});

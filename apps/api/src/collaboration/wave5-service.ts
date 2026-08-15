import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { projectSharedLeave } from '@caredesk/application';

export const WORKER_REQUEST_TRANSITIONS = {
  submitted: ['in_review', 'approved', 'rejected', 'resolved', 'cancelled'],
  in_review: ['approved', 'rejected', 'resolved'],
  approved: ['resolved'],
  rejected: ['resolved'],
  resolved: [],
  cancelled: [],
} as const;

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function invitationTokenMatches(token: string, digest: string): boolean {
  const candidate = Buffer.from(hashInvitationToken(token), 'hex');
  const expected = Buffer.from(digest, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

type Actor = { tenantId: string; userId: string };
type WorkerContext = {
  tenantId: string;
  userId: string;
  accessId: string;
  caseId: string;
  workerId: string;
};

interface PayrollCloseRow {
  id: string;
  payroll_month: string;
  payment_date: string;
  payment_method: 'bank_transfer' | 'cash' | 'check' | 'other';
  evidence_document_id: string | null;
}

interface PaymentAcknowledgementRow {
  payroll_month_close_id: string;
  acknowledged_at: Date;
}

/**
 * PostgreSQL-backed Wave 5 application boundary. Every statement runs after
 * setting the canonical RLS transaction context. Worker ids and case ids are
 * always resolved from the authenticated user's active portal relationship.
 */
export class Wave5Service {
  constructor(private readonly pool: Pool) {}

  private async tenantTx<T>(
    tenantId: string,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async workerContext(userId: string): Promise<WorkerContext | null> {
    // app_user is intentionally global identity data. The security-definer
    // lookup is avoided: query each candidate access under its own tenant RLS
    // context after obtaining only tenant ids linked to this authenticated id.
    const candidates = await this.pool.query<{ tenant_id: string }>(
      `select tenant_id from resolve_worker_portal_tenants($1)`,
      [userId],
    );
    for (const candidate of candidates.rows) {
      const context = await this.tenantTx(candidate.tenant_id, async (client) => {
        const result = await client.query<{
          tenant_id: string;
          id: string;
          employment_case_id: string;
          caregiver_id: string;
        }>(
          `select tenant_id, id, employment_case_id, caregiver_id from worker_portal_access
            where user_id = $1 and status = 'active' order by activated_at desc limit 1`,
          [userId],
        );
        const row = result.rows[0];
        return row
          ? {
              tenantId: row.tenant_id,
              userId,
              accessId: row.id,
              caseId: row.employment_case_id,
              workerId: row.caregiver_id,
            }
          : null;
      });
      if (context) return context;
    }
    return null;
  }

  async collaboration(actor: Actor, caseId: string) {
    return this.tenantTx(actor.tenantId, async (client) => {
      const [members, responsibilities, tasks, requests] = await Promise.all([
        client.query(
          `select tm.id, tm.role, tm.status, coalesce(au.display_name, au.email, '—') display_name
          from tenant_membership tm join app_user au on au.id=tm.user_id where tm.tenant_id=$1`,
          [actor.tenantId],
        ),
        client.query(
          `select responsibility, assignee_membership_id, effective_from from case_responsibility_assignment
          where employment_case_id=$1 and effective_to is null order by responsibility`,
          [caseId],
        ),
        client.query(
          `select id, title, status, due_at, assignee_membership_id from task
          where employment_case_id=$1 and status <> 'completed' order by due_at nulls last`,
          [caseId],
        ),
        client.query(
          `select id, request_type, message, status, assigned_membership_id, created_at
          from worker_request where employment_case_id=$1 and status not in ('resolved','cancelled') order by created_at desc`,
          [caseId],
        ),
      ]);
      return {
        members: members.rows,
        responsibilities: responsibilities.rows,
        tasks: tasks.rows,
        requests: requests.rows,
      };
    });
  }

  async assignResponsibility(
    actor: Actor,
    caseId: string,
    responsibility: string,
    assigneeId: string | null,
  ) {
    return this.tenantTx(actor.tenantId, async (client) => {
      const allowed = await client.query(
        `select 1 from tenant_membership where tenant_id=$1 and user_id=$2
        and status='active' and role in ('owner','manager')`,
        [actor.tenantId, actor.userId],
      );
      if (!allowed.rowCount) throw new Error('manager_required');
      if (assigneeId) {
        const valid = await client.query(
          `select 1 from tenant_membership where tenant_id=$1 and id=$2 and status='active'`,
          [actor.tenantId, assigneeId],
        );
        if (!valid.rowCount) throw new Error('invalid_assignee');
      }
      await client.query(
        `update case_responsibility_assignment set effective_to=now()
        where employment_case_id=$1 and responsibility=$2 and effective_to is null`,
        [caseId, responsibility],
      );
      if (!assigneeId) return null;
      const result = await client.query(
        `insert into case_responsibility_assignment
        (tenant_id, employment_case_id, responsibility, assignee_membership_id, assigned_by)
        values ($1,$2,$3,$4,$5) returning *`,
        [actor.tenantId, caseId, responsibility, assigneeId, actor.userId],
      );
      await client.query(
        `insert into audit_event (tenant_id, actor_id, action, resource_type, resource_id,
        occurred_at, correlation_id, purpose, change_summary, sensitivity)
        values ($1,$2,'responsibility.assigned','employment_case',$3,now(),$4,'case_management',
        'Responsibility owner changed.','general')`,
        [actor.tenantId, actor.userId, caseId, `wave5:${randomUUID()}`],
      );
      return result.rows[0];
    });
  }

  async inviteWorker(
    actor: Actor,
    input: { caseId: string; workerId: string; destination: string; expiresInHours?: number },
  ) {
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    await this.tenantTx(actor.tenantId, async (client) => {
      const allowed = await client.query(
        `select 1 from tenant_membership where tenant_id=$1 and user_id=$2
        and status='active' and role in ('owner','manager')`,
        [actor.tenantId, actor.userId],
      );
      if (!allowed.rowCount) throw new Error('manager_required');
      const access = await client.query<{ id: string }>(
        `insert into worker_portal_access
        (tenant_id, employment_case_id, caregiver_id, status) values ($1,$2,$3,'invited')
        returning id`,
        [actor.tenantId, input.caseId, input.workerId],
      );
      await client.query(
        `insert into worker_portal_invitation
        (id,tenant_id,worker_portal_access_id,destination_hint,token_hash,expires_at,invited_by)
        values ($1,$2,$3,$4,$5,now()+($6 || ' hours')::interval,$7)`,
        [
          id,
          actor.tenantId,
          access.rows[0]!.id,
          input.destination.replace(/^(.{2}).*(@.*)$/, '$1…$2'),
          hashInvitationToken(token),
          input.expiresInHours ?? 72,
          actor.userId,
        ],
      );
    });
    return { invitationId: id, token, expiresInHours: input.expiresInHours ?? 72 };
  }

  async consumeInvitation(userId: string, token: string) {
    const digest = hashInvitationToken(token);
    const found = await this.pool.query<{ tenant_id: string }>(
      `select tenant_id from resolve_worker_invitation_tenant($1)`,
      [digest],
    );
    const tenantId = found.rows[0]?.tenant_id;
    if (!tenantId) throw new Error('invalid_invitation');
    return this.tenantTx(tenantId, async (client) => {
      const invitation = await client.query<{ id: string; worker_portal_access_id: string }>(
        `select id,worker_portal_access_id from worker_portal_invitation where token_hash=$1
         and consumed_at is null and revoked_at is null and expires_at>now() for update`,
        [digest],
      );
      const row = invitation.rows[0];
      if (!row) throw new Error('invalid_invitation');
      await client.query(`update worker_portal_invitation set consumed_at=now() where id=$1`, [
        row.id,
      ]);
      await client.query(
        `update worker_portal_access set user_id=$1,status='active',activated_at=now()
        where id=$2 and status='invited'`,
        [userId, row.worker_portal_access_id],
      );
      return { activated: true };
    });
  }

  async workerHome(context: WorkerContext) {
    return this.tenantTx(context.tenantId, async (client) => {
      const [closes, acknowledgements, requests, documents] = await Promise.all([
        client.query<PayrollCloseRow>(
          `select id, payroll_month, payment_date, payment_method, evidence_document_id
          from payroll_month_close where employment_case_id=$1`,
          [context.caseId],
        ),
        client.query<PaymentAcknowledgementRow>(
          `select payroll_month_close_id, acknowledged_at from worker_payment_acknowledgement where worker_portal_access_id=$1`,
          [context.accessId],
        ),
        client.query(
          `select id,request_type,message,status,start_date,end_date,created_at,updated_at from worker_request
          where worker_portal_access_id=$1 order by created_at desc`,
          [context.accessId],
        ),
        client.query(
          `select id,document_type,created_at from document where employment_case_id=$1 and worker_visibility in ('worker_view','worker_action')`,
          [context.caseId],
        ),
      ]);
      const ack = new Map(
        acknowledgements.rows.map((row) => [row.payroll_month_close_id, row.acknowledged_at]),
      );
      // The durable close currently owns date/method/evidence but not the
      // calculated net amount. Returning null is deliberate: never fabricate
      // a financial figure until the canonical payroll store exposes it.
      const payments = closes.rows.map((row) => ({
        closeId: row.id,
        month: row.payroll_month,
        amountPaid: null,
        paymentDate: row.payment_date,
        paymentMethod: row.payment_method,
        evidenceAvailable: Boolean(row.evidence_document_id),
        acknowledgement: ack.has(row.id) ? 'acknowledged' : 'pending',
        acknowledgedAt: ack.get(row.id) ?? undefined,
      }));
      return {
        payments,
        leave: projectSharedLeave({
          caseId: context.caseId,
          workerId: context.workerId,
          facts: [],
        }),
        requests: requests.rows,
        documents: documents.rows,
      };
    });
  }

  async acknowledge(context: WorkerContext, closeId: string) {
    return this.tenantTx(context.tenantId, async (client) => {
      const close = await client.query(
        `select 1 from payroll_month_close where id=$1 and employment_case_id=$2`,
        [closeId, context.caseId],
      );
      if (!close.rowCount) throw new Error('payment_not_found');
      const result = await client.query(
        `insert into worker_payment_acknowledgement
        (tenant_id,payroll_month_close_id,worker_portal_access_id) values ($1,$2,$3)
        on conflict (tenant_id,payroll_month_close_id,worker_portal_access_id,acknowledgement_version)
        do update set payroll_month_close_id=excluded.payroll_month_close_id returning acknowledged_at`,
        [context.tenantId, closeId, context.accessId],
      );
      return result.rows[0];
    });
  }

  async createRequest(
    context: WorkerContext,
    input: { type: string; message: string; startDate?: string; endDate?: string },
  ) {
    return this.tenantTx(
      context.tenantId,
      async (client) =>
        (
          await client.query(
            `insert into worker_request
      (tenant_id,employment_case_id,worker_portal_access_id,request_type,message,start_date,end_date)
      values ($1,$2,$3,$4,$5,$6,$7) returning *`,
            [
              context.tenantId,
              context.caseId,
              context.accessId,
              input.type,
              input.message,
              input.startDate ?? null,
              input.endDate ?? null,
            ],
          )
        ).rows[0],
    );
  }

  async updateRequest(actor: Actor, requestId: string, status: string, assigneeId?: string) {
    return this.tenantTx(actor.tenantId, async (client) => {
      const role = await client.query(
        `select 1 from tenant_membership where tenant_id=$1 and user_id=$2 and status='active' and role in ('owner','manager')`,
        [actor.tenantId, actor.userId],
      );
      if (!role.rowCount) throw new Error('manager_required');
      const current = await client.query<{ status: keyof typeof WORKER_REQUEST_TRANSITIONS }>(
        `select status from worker_request where id=$1 for update`,
        [requestId],
      );
      const from = current.rows[0]?.status;
      if (!from || !(WORKER_REQUEST_TRANSITIONS[from] as readonly string[]).includes(status))
        throw new Error('invalid_transition');
      return (
        await client.query(
          `update worker_request set status=$2,assigned_membership_id=coalesce($3,assigned_membership_id),updated_at=now() where id=$1 returning *`,
          [requestId, status, assigneeId ?? null],
        )
      ).rows[0];
    });
  }
}

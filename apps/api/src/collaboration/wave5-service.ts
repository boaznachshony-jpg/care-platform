import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { projectSharedLeave, type DocumentStorage } from '@caredesk/application';

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
  constructor(
    private readonly pool: Pool,
    private readonly storage: DocumentStorage,
  ) {}

  private requestHash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private async idempotent<T>(
    client: PoolClient,
    tenantId: string,
    operation: string,
    key: string,
    input: unknown,
    work: () => Promise<T>,
  ): Promise<T> {
    const hash = this.requestHash(input);
    const existing = await client.query<{ request_hash: string; response: T }>(
      `select request_hash,response from idempotency_record where operation=$1 and idempotency_key=$2 for update`,
      [operation, key],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== hash) throw new Error('idempotency_conflict');
      return existing.rows[0].response;
    }
    const response = await work();
    await client.query(
      `insert into idempotency_record (tenant_id,operation,idempotency_key,request_hash,response)
       values ($1,$2,$3,$4,$5)`,
      [tenantId, operation, key, hash, JSON.stringify(response)],
    );
    return response;
  }

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
      const allowed = await client.query(
        `select 1 from tenant_membership where tenant_id=$1 and user_id=$2 and status='active' and role in ('owner','manager')`,
        [actor.tenantId, actor.userId],
      );
      if (!allowed.rowCount) throw new Error('manager_required');
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
    idempotencyKey: string,
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
      return this.idempotent(
        client,
        actor.tenantId,
        'wave5.responsibility',
        idempotencyKey,
        { caseId, responsibility, assigneeId },
        async () => {
          const caseExists = await client.query(`select 1 from employment_case where id=$1`, [
            caseId,
          ]);
          if (!caseExists.rowCount) throw new Error('case_not_found');
          await client.query(
            `update case_responsibility_assignment set effective_to=now()
        where employment_case_id=$1 and responsibility=$2 and effective_to is null`,
            [caseId, responsibility],
          );
          if (!assigneeId) return { assignment: null };
          const result = await client.query(
            `insert into case_responsibility_assignment
        (tenant_id, employment_case_id, responsibility, assignee_membership_id, assigned_by)
        values ($1,$2,$3,$4,$5) returning *`,
            [actor.tenantId, caseId, responsibility, assigneeId, actor.userId],
          );
          await client.query(
            `insert into timeline_event (tenant_id,employment_case_id,event_type_key,summary_key,
         source_type,source_id,sensitivity) values ($1,$2,'responsibility.changed',
         'Responsibility assignment changed.','responsibility_assignment',$3,'general')`,
            [actor.tenantId, caseId, result.rows[0].id],
          );
          await client.query(
            `insert into audit_event (tenant_id, actor_id, action, resource_type, resource_id,
        occurred_at, correlation_id, purpose, change_summary, sensitivity)
        values ($1,$2,'responsibility.assigned','employment_case',$3,now(),$4,'case_management',
        'Responsibility owner changed.','general')`,
            [actor.tenantId, actor.userId, caseId, `wave5:${randomUUID()}`],
          );
          return { assignment: result.rows[0] };
        },
      );
    });
  }

  async assignTask(
    actor: Actor,
    caseId: string,
    taskId: string,
    assigneeId: string | null,
    key: string,
  ) {
    return this.tenantTx(actor.tenantId, async (client) => {
      const role = await client.query(
        `select 1 from tenant_membership where tenant_id=$1 and user_id=$2 and status='active' and role in ('owner','manager')`,
        [actor.tenantId, actor.userId],
      );
      if (!role.rowCount) throw new Error('manager_required');
      if (
        assigneeId &&
        !(
          await client.query(`select 1 from tenant_membership where id=$1 and status='active'`, [
            assigneeId,
          ])
        ).rowCount
      )
        throw new Error('invalid_assignee');
      return this.idempotent(
        client,
        actor.tenantId,
        'wave5.task_assignment',
        key,
        { caseId, taskId, assigneeId },
        async () => {
          const row = (
            await client.query(
              `update task set assignee_membership_id=$3,updated_at=now() where id=$1 and employment_case_id=$2 returning id,assignee_membership_id`,
              [taskId, caseId, assigneeId],
            )
          ).rows[0];
          if (!row) throw new Error('task_not_found');
          await client.query(
            `insert into timeline_event (tenant_id,employment_case_id,event_type_key,summary_key,source_type,source_id,sensitivity) values ($1,$2,'task.assigned','Task responsibility changed.','task',$3,'general')`,
            [actor.tenantId, caseId, taskId],
          );
          await client.query(
            `insert into audit_event (tenant_id,actor_id,action,resource_type,resource_id,occurred_at,correlation_id,purpose,change_summary,sensitivity) values ($1,$2,'task.assigned','task',$3,now(),$4,'case_management','Task responsibility changed.','general')`,
            [actor.tenantId, actor.userId, taskId, `wave5:${key}`],
          );
          return row;
        },
      );
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
      // Evidence (capability #10): granting portal access is a security-
      // relevant mutation. Only the invitation id is recorded — never the
      // token or the destination address.
      await client.query(
        `insert into timeline_event (tenant_id,employment_case_id,event_type_key,summary_key,source_type,source_id,sensitivity) values ($1,$2,'worker.invited','Worker portal invitation issued.','worker_portal_invitation',$3,'general')`,
        [actor.tenantId, input.caseId, id],
      );
      await client.query(
        `insert into audit_event (tenant_id,actor_id,action,resource_type,resource_id,occurred_at,correlation_id,purpose,change_summary,sensitivity) values ($1,$2,'worker_invitation.created','worker_portal_invitation',$3,now(),$4,'worker_portal','Worker portal invitation issued.','general')`,
        [actor.tenantId, actor.userId, id, `wave5:invitation:${id}`],
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
      // Evidence (capability #10): activation changes who can reach case data,
      // so it is recorded like every other access-shaping mutation. The token
      // itself never appears — only the access row it activated.
      const access = await client.query<{ employment_case_id: string }>(
        `select employment_case_id from worker_portal_access where id=$1`,
        [row.worker_portal_access_id],
      );
      if (access.rows[0]) {
        await client.query(
          `insert into timeline_event (tenant_id,employment_case_id,event_type_key,summary_key,source_type,source_id,sensitivity) values ($1,$2,'worker.portal_activated','Worker portal access activated.','worker_portal_access',$3,'general')`,
          [tenantId, access.rows[0].employment_case_id, row.worker_portal_access_id],
        );
      }
      await client.query(
        `insert into audit_event (tenant_id,actor_id,action,resource_type,resource_id,occurred_at,correlation_id,purpose,change_summary,sensitivity) values ($1,$2,'worker_invitation.consumed','worker_portal_access',$3,now(),$4,'worker_portal','Worker portal invitation consumed; access activated.','general')`,
        [tenantId, userId, row.worker_portal_access_id, `wave5:activation:${row.id}`],
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
      const result = await client.query<{ acknowledged_at: Date }>(
        `insert into worker_payment_acknowledgement
        (tenant_id,payroll_month_close_id,worker_portal_access_id) values ($1,$2,$3)
        on conflict (tenant_id,payroll_month_close_id,worker_portal_access_id,acknowledgement_version)
        do update set payroll_month_close_id=excluded.payroll_month_close_id returning acknowledged_at, (xmax = 0) as inserted`,
        [context.tenantId, closeId, context.accessId],
      );
      // Evidence (capability #10): the worker's acknowledgement of a payroll
      // close is itself compliance evidence. Recorded only on first insert so
      // an idempotent replay does not duplicate the trail. No amounts appear —
      // only the close being acknowledged.
      const row = result.rows[0] as { acknowledged_at: Date; inserted?: boolean };
      if (row.inserted) {
        await client.query(
          `insert into timeline_event (tenant_id,employment_case_id,event_type_key,summary_key,source_type,source_id,sensitivity) values ($1,$2,'payment.acknowledged','Worker acknowledged a payment.','payroll_month_close',$3,'financial_sensitive')`,
          [context.tenantId, context.caseId, closeId],
        );
        await client.query(
          `insert into audit_event (tenant_id,actor_id,action,resource_type,resource_id,occurred_at,correlation_id,purpose,change_summary,sensitivity) values ($1,$2,'payment.acknowledged','payroll_month_close',$3,now(),$4,'worker_portal','Worker acknowledged a payroll month close.','financial_sensitive')`,
          [context.tenantId, context.userId, closeId, `wave5:acknowledgement:${closeId}`],
        );
      }
      return { acknowledged_at: row.acknowledged_at };
    });
  }

  async createRequest(
    context: WorkerContext,
    input: { type: string; message: string; startDate?: string; endDate?: string },
    key: string,
  ) {
    return this.tenantTx(context.tenantId, async (client) =>
      this.idempotent(client, context.tenantId, 'wave5.worker_request', key, input, async () => {
        const request = (
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
        ).rows[0];
        await client.query(
          `insert into timeline_event (tenant_id,employment_case_id,event_type_key,summary_key,source_type,source_id,sensitivity) values ($1,$2,'worker_request.submitted','Worker submitted a request.','worker_request',$3,'general')`,
          [context.tenantId, context.caseId, request.id],
        );
        await client.query(
          `insert into audit_event (tenant_id,actor_id,action,resource_type,resource_id,occurred_at,correlation_id,purpose,change_summary,sensitivity) values ($1,$2,'worker_request.submitted','worker_request',$3,now(),$4,'worker_portal','Worker request submitted.','general')`,
          [context.tenantId, context.userId, request.id, `wave5:${key}`],
        );
        const manager = (
          await client.query<{ id: string }>(
            `select id from tenant_membership where tenant_id=$1 and status='active' and role in ('owner','manager') order by created_at limit 1`,
            [context.tenantId],
          )
        ).rows[0];
        if (manager)
          await client.query(
            `insert into notification_intent (tenant_id,recipient_type,recipient_id,event_type,template_key,template_version,locale,authenticated_path,idempotency_key) values ($1,'family_member',$2,'worker_request.submitted','worker_request.submitted',1,'he',$3,$4) on conflict (tenant_id,idempotency_key) do nothing`,
            [context.tenantId, manager.id, `/cases/${context.caseId}`, `worker-request:${key}`],
          );
        return request;
      }),
    );
  }

  async updateRequest(
    actor: Actor,
    requestId: string,
    status: string,
    key: string,
    assigneeId?: string,
  ) {
    return this.tenantTx(actor.tenantId, async (client) => {
      const role = await client.query(
        `select 1 from tenant_membership where tenant_id=$1 and user_id=$2 and status='active' and role in ('owner','manager')`,
        [actor.tenantId, actor.userId],
      );
      if (!role.rowCount) throw new Error('manager_required');
      return this.idempotent(
        client,
        actor.tenantId,
        'wave5.request_handling',
        key,
        { requestId, status, assigneeId },
        async () => {
          if (
            assigneeId &&
            !(
              await client.query(
                `select 1 from tenant_membership where id=$1 and status='active'`,
                [assigneeId],
              )
            ).rowCount
          )
            throw new Error('invalid_assignee');
          const current = await client.query<{
            status: keyof typeof WORKER_REQUEST_TRANSITIONS;
            employment_case_id: string;
          }>(`select status,employment_case_id from worker_request where id=$1 for update`, [
            requestId,
          ]);
          const from = current.rows[0]?.status;
          if (!from || !(WORKER_REQUEST_TRANSITIONS[from] as readonly string[]).includes(status))
            throw new Error('invalid_transition');
          const updated = (
            await client.query(
              `update worker_request set status=$2,assigned_membership_id=coalesce($3,assigned_membership_id),updated_at=now() where id=$1 returning *`,
              [requestId, status, assigneeId ?? null],
            )
          ).rows[0];
          await client.query(
            `insert into timeline_event (tenant_id,employment_case_id,event_type_key,summary_key,source_type,source_id,sensitivity) values ($1,$2,'worker_request.handled','Worker request status changed.','worker_request',$3,'general')`,
            [actor.tenantId, current.rows[0]!.employment_case_id, requestId],
          );
          await client.query(
            `insert into audit_event (tenant_id,actor_id,action,resource_type,resource_id,occurred_at,correlation_id,purpose,change_summary,sensitivity) values ($1,$2,'worker_request.handled','worker_request',$3,now(),$4,'case_management','Worker request status changed.','general')`,
            [actor.tenantId, actor.userId, requestId, `wave5:${key}`],
          );
          return updated;
        },
      );
    });
  }

  async workerDocument(context: WorkerContext, documentId: string) {
    const record = await this.tenantTx(context.tenantId, async (client) => {
      // Recheck active access in the same transaction as authorization so revocation is immediate.
      const active = await client.query(
        `select 1 from worker_portal_access where id=$1 and user_id=$2 and status='active'`,
        [context.accessId, context.userId],
      );
      if (!active.rowCount) throw new Error('worker_access_denied');
      const row = (
        await client.query<{ storage_key: string }>(
          `select v.storage_key from document d join document_version v on v.id=d.current_version_id and v.tenant_id=d.tenant_id where d.id=$1 and d.employment_case_id=$2 and d.status='active' and d.worker_visibility in ('worker_view','worker_action')`,
          [documentId, context.caseId],
        )
      ).rows[0];
      if (!row) throw new Error('document_not_found');
      await client.query(
        `insert into audit_event (tenant_id,actor_id,action,resource_type,resource_id,occurred_at,correlation_id,purpose,change_summary,sensitivity) values ($1,$2,'worker_document.accessed','document',$3,now(),$4,'worker_portal','Authorized worker document link issued.','sensitive')`,
        [context.tenantId, context.userId, documentId, `worker-document:${randomUUID()}`],
      );
      return row;
    });
    return { url: await this.storage.getSignedUrl(record.storage_key, 300), expiresInSeconds: 300 };
  }

  async preference(context: WorkerContext) {
    return this.tenantTx(
      context.tenantId,
      async (client) =>
        (
          await client.query(
            `select preferred_locale,preferred_channel,email_enabled,whatsapp_enabled,sms_enabled,whatsapp_consent,sms_consent from communication_preference where participant_type='worker' and participant_id=$1`,
            [context.accessId],
          )
        ).rows[0] ?? {
          preferred_locale: 'he',
          preferred_channel: 'email',
          email_enabled: true,
          whatsapp_enabled: false,
          sms_enabled: false,
          whatsapp_consent: 'unknown',
          sms_consent: 'unknown',
        },
    );
  }

  async updatePreference(
    context: WorkerContext,
    input: {
      locale: 'he' | 'en';
      channel: 'email';
      whatsappConsent: 'unknown' | 'revoked';
      smsConsent: 'unknown' | 'revoked';
    },
    key: string,
  ) {
    return this.tenantTx(context.tenantId, async (client) => {
      const active = await client.query(
        `select 1 from worker_portal_access where id=$1 and user_id=$2 and status='active'`,
        [context.accessId, context.userId],
      );
      if (!active.rowCount) throw new Error('worker_access_denied');
      return this.idempotent(
        client,
        context.tenantId,
        'wave5.worker_preference',
        key,
        input,
        async () => {
          const row = (
            await client.query(
              `insert into communication_preference (tenant_id,participant_type,participant_id,preferred_locale,preferred_channel,email_enabled,whatsapp_enabled,sms_enabled,whatsapp_consent,sms_consent,consent_source,consent_recorded_at,revoked_at) values ($1,'worker',$2,$3,'email',true,false,false,$4,$5,'worker_portal',now(),case when $4='revoked' or $5='revoked' then now() end) on conflict (tenant_id,participant_type,participant_id) do update set preferred_locale=excluded.preferred_locale,preferred_channel='email',email_enabled=true,whatsapp_enabled=false,sms_enabled=false,whatsapp_consent=excluded.whatsapp_consent,sms_consent=excluded.sms_consent,consent_source='worker_portal',consent_recorded_at=now(),revoked_at=excluded.revoked_at,updated_at=now() returning preferred_locale,preferred_channel,email_enabled,whatsapp_enabled,sms_enabled,whatsapp_consent,sms_consent`,
              [
                context.tenantId,
                context.accessId,
                input.locale,
                input.whatsappConsent,
                input.smsConsent,
              ],
            )
          ).rows[0];
          await client.query(
            `insert into timeline_event (tenant_id,employment_case_id,event_type_key,summary_key,source_type,source_id,sensitivity) values ($1,$2,'communication.preference_changed','Worker communication preference changed.','worker_portal_access',$3,'general')`,
            [context.tenantId, context.caseId, context.accessId],
          );
          await client.query(
            `insert into audit_event (tenant_id,actor_id,action,resource_type,resource_id,occurred_at,correlation_id,purpose,change_summary,sensitivity) values ($1,$2,'communication.preference_changed','worker_portal_access',$3,now(),$4,'worker_portal','Communication preference changed.','general')`,
            [context.tenantId, context.userId, context.accessId, `wave5:${key}`],
          );
          return row;
        },
      );
    });
  }
}

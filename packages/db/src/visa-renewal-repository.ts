import type {
  IdempotencyRecord,
  IdempotencyRepository,
  StartVisaRenewalRecord,
  VisaRenewalRepository,
  VisaRenewalProgressRepository,
  VisaRenewalSideEffects,
  VisaRenewalEvaluationRepository,
  VisaRenewalWorkflow,
  VisaRuleEvaluation,
  VisaWorkflowAssignment,
  VisaWorkflowBlocker,
} from '@caredesk/application';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from './pool.js';

interface WorkflowRow {
  id: string;
  tenant_id: string;
  employment_case_id: string;
  template_version_id: string;
  current_authorization_id: string;
  status: VisaRenewalWorkflow['status'];
  linked_renewed_authorization_id: string | null;
  linked_document_version_id: string | null;
  completed_at: Date | null;
  rule_definition_id: string;
  rule_version_id: string;
  evaluation_status: VisaRuleEvaluation['status'];
  evaluated_as_of: Date;
  due_date: string | null;
  priority: VisaRuleEvaluation['priority'];
  explanation_key: string;
  review_required: boolean;
}

const WORKFLOW_SELECT = `
  select wi.id, wi.tenant_id, wi.employment_case_id, wi.template_version_id,
         wi.current_authorization_id, wi.status, wi.linked_renewed_authorization_id,
         wi.linked_document_version_id, wi.completed_at,
         ev.rule_definition_id, ev.rule_version_id, ev.status as evaluation_status,
         ev.evaluated_as_of, ev.due_date, ev.priority, ev.explanation_key,
         ev.review_required
    from workflow_instance wi
    join workflow_rule_evaluation ev on ev.tenant_id = wi.tenant_id
                                    and ev.workflow_instance_id = wi.id`;

async function hydrate(client: PoolClient, row: WorkflowRow): Promise<VisaRenewalWorkflow> {
  const [assignments, blockers, sources] = await Promise.all([
    client.query<VisaWorkflowAssignment>(
      `select ws.step_key as "stepKey", wa.raci_role as "raciRole",
              wa.assignee_type as "assigneeType",
              coalesce(wa.assignee_membership_id, wa.assignee_contact_id) as "assigneeId"
         from workflow_assignment wa join workflow_step ws
           on ws.tenant_id = wa.tenant_id and ws.id = wa.workflow_step_id
        where ws.workflow_instance_id = $1 order by ws.position, wa.id`,
      [row.id],
    ),
    client.query<VisaWorkflowBlocker>(
      `select wb.code, ws.step_key as "stepKey",
              wb.owner_assignment_id as "ownerAssignmentId",
              wb.next_review_at as "nextReviewAt"
         from workflow_blocker wb join workflow_step ws
           on ws.tenant_id = wb.tenant_id and ws.id = wb.workflow_step_id
        where ws.workflow_instance_id = $1 and wb.resolved_at is null
        order by ws.position, wb.id`,
      [row.id],
    ),
    client.query<{ source_reference: string }>(
      `select rs.source_reference from workflow_evaluation_source es
         join visa_rule_source rs on rs.id = es.rule_source_id
        where es.workflow_instance_id = $1 order by rs.source_reference`,
      [row.id],
    ),
  ]);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    employmentCaseId: row.employment_case_id,
    templateVersionId: row.template_version_id,
    currentAuthorizationId: row.current_authorization_id,
    status: row.status,
    evaluation: {
      ruleDefinitionId: row.rule_definition_id,
      ruleVersionId: row.rule_version_id,
      status: row.evaluation_status,
      asOf: row.evaluated_as_of.toISOString(),
      dueDate: row.due_date,
      priority: row.priority,
      explanationKey: row.explanation_key,
      sourceReferences: sources.rows.map((source) => source.source_reference),
      reviewRequired: row.review_required,
    },
    assignments: assignments.rows,
    blockers: blockers.rows.map((blocker) => ({
      ...blocker,
      nextReviewAt: blocker.nextReviewAt ? new Date(blocker.nextReviewAt).toISOString() : null,
    })),
    linkedRenewedAuthorizationId: row.linked_renewed_authorization_id,
    linkedDocumentVersionId: row.linked_document_version_id,
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

export class PgVisaRenewalRepository implements VisaRenewalRepository {
  constructor(private readonly pool: Pool) {}

  async start(input: StartVisaRenewalRecord): Promise<VisaRenewalWorkflow> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const inserted = await client.query(
        `insert into workflow_instance
          (id, tenant_id, employment_case_id, template_version_id, current_authorization_id)
         select $1, $2, $3, id, $5 from workflow_template_version
          where id = $4 and status = 'active'`,
        [
          input.id,
          input.tenantId,
          input.employmentCaseId,
          input.templateVersionId,
          input.currentAuthorizationId,
        ],
      );
      if (inserted.rowCount !== 1) throw new Error('Workflow template version is not active.');
      await client.query(
        `insert into workflow_rule_evaluation
          (workflow_instance_id, tenant_id, rule_definition_id, rule_version_id, status,
           evaluated_as_of, due_date, priority, explanation_key, review_required)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          input.id,
          input.tenantId,
          input.evaluation.ruleDefinitionId,
          input.evaluation.ruleVersionId,
          input.evaluation.status,
          input.evaluation.asOf,
          input.evaluation.dueDate,
          input.evaluation.priority,
          input.evaluation.explanationKey,
          input.evaluation.reviewRequired,
        ],
      );
      const steps = await client.query<{ id: string; step_key: string }>(
        `insert into workflow_step
          (tenant_id, workflow_instance_id, template_step_id, step_key, position)
         select $1, $2, id, step_key, position from workflow_template_step
          where workflow_template_version_id = $3 order by position
         returning id, step_key`,
        [input.tenantId, input.id, input.templateVersionId],
      );
      if (steps.rowCount === 0) throw new Error('Workflow template version has no steps.');
      const stepIds = new Map(steps.rows.map((step) => [step.step_key, step.id]));
      for (const assignment of input.assignments) {
        const stepId = stepIds.get(assignment.stepKey);
        if (!stepId) throw new Error(`Assignment references unknown step: ${assignment.stepKey}`);
        await client.query(
          `insert into workflow_assignment
            (tenant_id, workflow_step_id, raci_role, assignee_type,
             assignee_membership_id, assignee_contact_id)
           values ($1,$2,$3,$4,
             case when $4 = 'user' then $5::uuid end,
             case when $4 = 'contact' then $5::uuid end)`,
          [
            input.tenantId,
            stepId,
            assignment.raciRole,
            assignment.assigneeType,
            assignment.assigneeId,
          ],
        );
      }
      for (const reference of input.evaluation.sourceReferences) {
        const linked = await client.query(
          `insert into workflow_evaluation_source
            (tenant_id, workflow_instance_id, rule_source_id)
           select $1, $2, id from visa_rule_source
            where rule_version_id = $3 and source_reference = $4`,
          [input.tenantId, input.id, input.evaluation.ruleVersionId, reference],
        );
        if (linked.rowCount !== 1) throw new Error(`Unknown approved rule source: ${reference}`);
      }
      const result = await client.query<WorkflowRow>(`${WORKFLOW_SELECT} where wi.id = $1`, [
        input.id,
      ]);
      const row = result.rows[0];
      if (!row) throw new Error('Workflow insert returned no row.');
      return hydrate(client, row);
    });
  }

  async find(tenantId: string, workflowId: string): Promise<VisaRenewalWorkflow | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<WorkflowRow>(`${WORKFLOW_SELECT} where wi.id = $1`, [
        workflowId,
      ]);
      return result.rows[0] ? hydrate(client, result.rows[0]) : null;
    });
  }

  async listByCase(tenantId: string, employmentCaseId: string): Promise<VisaRenewalWorkflow[]> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<WorkflowRow>(
        `${WORKFLOW_SELECT} where wi.employment_case_id = $1 order by wi.created_at desc`,
        [employmentCaseId],
      );
      return Promise.all(result.rows.map((row) => hydrate(client, row)));
    });
  }
}

/** Reads only professionally activated, source-backed rule versions. */
export class PgVisaRenewalEvaluationRepository implements VisaRenewalEvaluationRepository {
  constructor(private readonly pool: Pool) {}
  async evaluate(asOf: string): Promise<VisaRuleEvaluation> {
    const result = await this.pool.query<{
      definition_id: string;
      version_id: string;
      explanation_key: string;
      source_reference: string;
    }>(
      `select d.id as definition_id, v.id as version_id,
              d.description_key as explanation_key, s.source_reference
         from visa_rule_version v
         join visa_rule_definition d on d.id = v.rule_definition_id
         join visa_rule_source s on s.rule_version_id = v.id
        where v.status = 'active'
          and (v.effective_from is null or v.effective_from <= $1::date)
          and (v.effective_to is null or v.effective_to >= $1::date)
        order by v.version desc, s.source_reference`,
      [asOf],
    );
    const first = result.rows[0];
    const versionIds = new Set(result.rows.map((row) => row.version_id));
    return {
      ruleDefinitionId: first?.definition_id ?? '00000000-0000-0000-0000-000000000000',
      ruleVersionId: first?.version_id ?? '00000000-0000-0000-0000-000000000000',
      status: !first ? 'unavailable' : versionIds.size === 1 ? 'active' : 'conflicting',
      asOf,
      dueDate: null,
      priority: null,
      explanationKey: first?.explanation_key ?? 'visa_renewal.rule_unavailable',
      sourceReferences: result.rows
        .filter((row) => row.version_id === first?.version_id)
        .map((row) => row.source_reference),
      reviewRequired: !first || versionIds.size !== 1,
    };
  }
}

export class PgIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly pool: Pool) {}
  async findIdempotency<T>(
    tenantId: string,
    operation: string,
    key: string,
  ): Promise<IdempotencyRecord<T> | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<{ request_hash: string; response: T }>(
        `select request_hash, response from idempotency_record
          where operation = $1 and idempotency_key = $2
            and (expires_at is null or expires_at > now())`,
        [operation, key],
      );
      const row = result.rows[0];
      return row ? { operation, key, requestHash: row.request_hash, response: row.response } : null;
    });
  }
  async saveIdempotency<T>(tenantId: string, record: IdempotencyRecord<T>): Promise<void> {
    await withTenant(this.pool, tenantId, async (client) => {
      await client.query(
        `insert into idempotency_record
          (tenant_id, operation, idempotency_key, request_hash, response)
         values ($1,$2,$3,$4,$5) on conflict do nothing`,
        [
          tenantId,
          record.operation,
          record.key,
          record.requestHash,
          JSON.stringify(record.response),
        ],
      );
    });
  }
}

interface VisaRenewalSideEffectEvent {
  tenantId: string;
  employmentCaseId: string;
  workflowId: string;
  actorId: string;
  correlationId: string;
  occurredAt: string;
  action: string;
  sensitivity: Parameters<VisaRenewalSideEffects['record']>[0]['sensitivity'];
}

/** Delivers the user timeline and immutable security audit in one transaction. */
export class PgVisaRenewalSideEffects implements VisaRenewalSideEffects {
  constructor(private readonly pool: Pool) {}
  async record(event: VisaRenewalSideEffectEvent): Promise<void> {
    await withTenant(this.pool, event.tenantId, async (client) => {
      await client.query(
        `insert into timeline_event (tenant_id, employment_case_id, event_type_key,
          summary_key, occurred_at, source_type, source_id, sensitivity)
         values ($1,$2,$3,$3,$4,'workflow',$5,$6)`,
        [
          event.tenantId,
          event.employmentCaseId,
          event.action,
          event.occurredAt,
          event.workflowId,
          event.sensitivity,
        ],
      );
      await client.query(
        `insert into audit_event (tenant_id, actor_id, action, resource_type,
          resource_id, occurred_at, correlation_id, sensitivity)
         values ($1,$2,$3,'workflow_instance',$4,$5,$6,$7)`,
        [
          event.tenantId,
          event.actorId,
          event.action,
          event.workflowId,
          event.occurredAt,
          event.correlationId,
          event.sensitivity,
        ],
      );
    });
  }
}

/** Writes each remaining workflow transition in a tenant-scoped transaction. */
export class PgVisaRenewalProgressRepository implements VisaRenewalProgressRepository {
  constructor(private readonly pool: Pool) {}

  async recordContactActivity(
    input: Parameters<VisaRenewalProgressRepository['recordContactActivity']>[0],
  ): Promise<void> {
    await withTenant(this.pool, input.tenantId, (client) =>
      client.query(
        `insert into workflow_contact_activity
          (id, tenant_id, employment_case_id, workflow_instance_id, workflow_step_id,
           organization_id, contact_id, channel, occurred_at, purpose, outcome,
           follow_up_at, confirmation_status, sensitivity, visibility, recorded_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          input.id,
          input.tenantId,
          input.employmentCaseId,
          input.workflowId,
          input.workflowStepId,
          input.organizationId,
          input.contactId,
          input.channel,
          input.occurredAt,
          input.purpose,
          input.outcome,
          input.followUpAt,
          input.confirmationStatus,
          input.sensitivity,
          input.visibility,
          input.recordedBy,
        ],
      ),
    );
  }

  async linkRenewedAuthorization(
    input: Parameters<VisaRenewalProgressRepository['linkRenewedAuthorization']>[0],
  ): Promise<void> {
    await withTenant(this.pool, input.tenantId, async (client) => {
      const linked = await client.query(
        `insert into employment_authorization_link
          (id, tenant_id, employment_case_id, workflow_instance_id,
           prior_authorization_id, renewed_authorization_id, document_version_id,
           linked_by, linked_at)
         select $1,$2,$3,wi.id,$5,$6,$7,$8,$9
           from workflow_instance wi
           join employment_authorization prior
             on prior.tenant_id = wi.tenant_id and prior.id = $5
           join employment_authorization renewed
             on renewed.tenant_id = wi.tenant_id and renewed.id = $6
           join document_version dv on dv.tenant_id = wi.tenant_id and dv.id = $7
          where wi.tenant_id = $2 and wi.id = $4
            and wi.employment_case_id = $3
            and prior.employment_case_id = $3
            and renewed.employment_case_id = $3
            and dv.verification_status = 'verified'`,
        [
          input.id,
          input.tenantId,
          input.employmentCaseId,
          input.workflowId,
          input.priorAuthorizationId,
          input.renewedAuthorizationId,
          input.documentVersionId,
          input.linkedBy,
          input.linkedAt,
        ],
      );
      if (linked.rowCount !== 1)
        throw new Error('Renewed authorization linkage is invalid or unverified.');
      await client.query(
        `update workflow_instance
            set linked_renewed_authorization_id = $1,
                linked_document_version_id = $2, updated_at = $3, version = version + 1
          where tenant_id = $4 and id = $5`,
        [
          input.renewedAuthorizationId,
          input.documentVersionId,
          input.linkedAt,
          input.tenantId,
          input.workflowId,
        ],
      );
    });
  }

  async openOverlapReview(
    input: Parameters<VisaRenewalProgressRepository['openOverlapReview']>[0],
  ): Promise<void> {
    await withTenant(this.pool, input.tenantId, (client) =>
      client.query(
        `insert into authorization_overlap_review
          (id, tenant_id, employment_case_id, workflow_instance_id,
           first_authorization_id, second_authorization_id)
         values ($1,$2,$3,$4,$5,$6)`,
        [
          input.id,
          input.tenantId,
          input.employmentCaseId,
          input.workflowId,
          input.firstAuthorizationId,
          input.secondAuthorizationId,
        ],
      ),
    );
  }

  async complete(input: Parameters<VisaRenewalProgressRepository['complete']>[0]): Promise<void> {
    await withTenant(this.pool, input.tenantId, async (client) => {
      const completed = await client.query(
        `with eligible as (
           select wi.id
             from workflow_instance wi
             join employment_authorization_link al
               on al.tenant_id = wi.tenant_id and al.workflow_instance_id = wi.id
             join document_version dv
               on dv.tenant_id = al.tenant_id and dv.id = al.document_version_id
            where wi.tenant_id = $2 and wi.id = $4 and wi.employment_case_id = $3
              and wi.status in ('active', 'blocked')
              and dv.verification_status = 'verified'
              and not exists (select 1 from workflow_step ws
                where ws.tenant_id = wi.tenant_id and ws.workflow_instance_id = wi.id
                  and ws.status not in ('completed', 'cancelled'))
              and not exists (select 1 from authorization_overlap_review ar
                where ar.tenant_id = wi.tenant_id and ar.workflow_instance_id = wi.id
                  and ar.status <> 'resolved')
         ), workflow_update as (
           update workflow_instance wi set status = 'completed', completed_at = $10,
                  updated_at = $10, version = version + 1
             from eligible e where wi.id = e.id returning wi.id
         ), task_update as (
           update task t set status = 'completed', completed_at = $10,
                  completed_by = $8, updated_at = $10, updated_by = $8,
                  version = version + 1
             from workflow_update wu
            where t.tenant_id = $2 and t.id = $5 and t.employment_case_id = $3
              and t.workflow_instance_id = wu.id and t.status <> 'completed'
           returning t.id
         ), timeline_insert as (
           insert into timeline_event
             (id, tenant_id, employment_case_id, event_type_key, summary_key,
              occurred_at, source_type, source_id, sensitivity)
           select $6,$2,$3,'visa_renewal.workflow_completed',
                  'visa_renewal.workflow_completed',$10,'workflow',$4,
                  'identity_sensitive' from task_update returning id
         ), audit_insert as (
           insert into audit_event
             (id, tenant_id, actor_id, action, resource_type, resource_id,
              occurred_at, correlation_id, sensitivity)
           select $7,$2,$8,'visa_renewal.workflow_completed','workflow_instance',$4,
                  $10,$9,'identity_sensitive' from timeline_insert returning id
         )
         insert into workflow_completion
           (id, tenant_id, employment_case_id, workflow_instance_id, completed_task_id,
            timeline_event_id, audit_event_id, completed_by, completed_at, correlation_id)
         select $1,$2,$3,$4,$5,$6,$7,$8,$10,$9 from audit_insert`,
        [
          input.id,
          input.tenantId,
          input.employmentCaseId,
          input.workflowId,
          input.taskId,
          input.timelineEventId,
          input.auditEventId,
          input.completedBy,
          input.correlationId,
          input.completedAt,
        ],
      );
      if (completed.rowCount !== 1)
        throw new Error('Visa renewal is not eligible for synchronized completion.');
    });
  }
}

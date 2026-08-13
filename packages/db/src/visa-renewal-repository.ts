import type {
  IdempotencyRecord,
  IdempotencyRepository,
  StartVisaRenewalRecord,
  VisaRenewalRepository,
  VisaRenewalSideEffects,
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

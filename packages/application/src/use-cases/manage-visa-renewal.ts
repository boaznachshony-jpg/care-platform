import type {
  AuditService,
  AuthorizationService,
  Clock,
  IdGenerator,
  IdempotencyRepository,
  VisaRenewalRepository,
  VisaRenewalSideEffects,
  VisaRuleEvaluation,
  VisaWorkflowAssignment,
  VisaRenewalWorkflow,
} from '../index.js';
import type { Actor } from './actor.js';
import { authorizeOrThrow } from './authorize.js';

export class VisaRenewalValidationError extends Error {
  constructor(public readonly code: 'RULE_UNVERIFIED' | 'RACI_INVALID' | 'IDEMPOTENCY_KEY_REUSED') {
    super(code);
  }
}

export interface StartVisaRenewalInput {
  templateVersionId: string;
  currentAuthorizationId: string;
  evaluation: VisaRuleEvaluation;
  assignments: readonly VisaWorkflowAssignment[];
  idempotencyKey: string;
  requestHash: string;
}

type StartDeps = {
  authorization: AuthorizationService;
  audit: AuditService;
  clock: Clock;
  ids: IdGenerator;
  workflows: VisaRenewalRepository;
  idempotency: IdempotencyRepository;
  sideEffects?: VisaRenewalSideEffects;
};

function assertRaci(assignments: readonly VisaWorkflowAssignment[]): void {
  const steps = new Map<string, VisaWorkflowAssignment[]>();
  for (const assignment of assignments)
    steps.set(assignment.stepKey, [...(steps.get(assignment.stepKey) ?? []), assignment]);
  for (const values of steps.values()) {
    if (
      values.filter((x) => x.raciRole === 'accountable').length !== 1 ||
      !values.some((x) => x.raciRole === 'responsible')
    )
      throw new VisaRenewalValidationError('RACI_INVALID');
  }
}

/** Starts only from a source-backed active evaluation; legal truth is never inferred here. */
export class StartVisaRenewalWorkflow {
  constructor(private readonly deps: StartDeps) {}
  async execute(
    actor: Actor,
    caseId: string,
    input: StartVisaRenewalInput,
  ): Promise<VisaRenewalWorkflow> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'workflow',
      action: 'start',
      caseId,
      sensitivity: 'identity_sensitive',
    });
    if (
      input.evaluation.status !== 'active' ||
      input.evaluation.reviewRequired ||
      input.evaluation.sourceReferences.length === 0
    )
      throw new VisaRenewalValidationError('RULE_UNVERIFIED');
    assertRaci(input.assignments);
    const existing = await this.deps.idempotency.findIdempotency<VisaRenewalWorkflow>(
      actor.tenantId,
      'visa_renewal.start',
      input.idempotencyKey,
    );
    if (existing) {
      if (existing.requestHash !== input.requestHash)
        throw new VisaRenewalValidationError('IDEMPOTENCY_KEY_REUSED');
      return existing.response;
    }
    const now = this.deps.clock.now().toISOString();
    const workflow = await this.deps.workflows.start({
      id: this.deps.ids.next(),
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      templateVersionId: input.templateVersionId,
      currentAuthorizationId: input.currentAuthorizationId,
      evaluation: input.evaluation,
      assignments: input.assignments,
    });
    if (this.deps.sideEffects) {
      await this.deps.sideEffects.record({
        tenantId: actor.tenantId,
        employmentCaseId: caseId,
        workflowId: workflow.id,
        actorId: actor.userId,
        correlationId: actor.correlationId,
        occurredAt: now,
        action: 'visa_renewal.workflow_started',
        sensitivity: 'identity_sensitive',
      });
    } else {
      await this.deps.audit.record({
        tenantId: actor.tenantId,
        actorId: actor.userId,
        action: 'visa_renewal.workflow_started',
        resourceType: 'workflow_instance',
        resourceId: workflow.id,
        correlationId: actor.correlationId,
        occurredAt: now,
        sensitivity: 'identity_sensitive',
      });
    }
    await this.deps.idempotency.saveIdempotency(actor.tenantId, {
      operation: 'visa_renewal.start',
      key: input.idempotencyKey,
      requestHash: input.requestHash,
      response: workflow,
    });
    return workflow;
  }
}

export class ListVisaRenewalWorkflows {
  constructor(
    private readonly deps: Pick<StartDeps, 'authorization' | 'audit' | 'clock' | 'workflows'>,
  ) {}
  async execute(actor: Actor, caseId: string): Promise<VisaRenewalWorkflow[]> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'workflow',
      action: 'read',
      caseId,
      sensitivity: 'identity_sensitive',
    });
    return this.deps.workflows.listByCase(actor.tenantId, caseId);
  }
}

export class GetVisaRenewalWorkflow {
  constructor(
    private readonly deps: Pick<StartDeps, 'authorization' | 'audit' | 'clock' | 'workflows'>,
  ) {}
  async execute(
    actor: Actor,
    caseId: string,
    workflowId: string,
  ): Promise<VisaRenewalWorkflow | null> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'workflow',
      action: 'read',
      caseId,
      resourceId: workflowId,
      sensitivity: 'identity_sensitive',
    });
    const workflow = await this.deps.workflows.find(actor.tenantId, workflowId);
    return workflow?.employmentCaseId === caseId ? workflow : null;
  }
}

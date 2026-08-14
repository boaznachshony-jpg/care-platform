import type {
  AuditService,
  AuthorizationService,
  Clock,
  IdGenerator,
  IdempotencyRepository,
  VisaRenewalRepository,
  VisaRenewalProgressRepository,
  VisaRenewalSideEffects,
  VisaRuleEvaluation,
  VisaWorkflowAssignment,
  VisaRenewalWorkflow,
} from '../index.js';
import type { Actor } from './actor.js';
import { authorizeOrThrow } from './authorize.js';

export class VisaRenewalValidationError extends Error {
  constructor(
    public readonly code:
      | 'RULE_UNVERIFIED'
      | 'RACI_INVALID'
      | 'IDEMPOTENCY_KEY_REUSED'
      | 'WORKFLOW_NOT_FOUND'
      | 'COMPLETION_INVALID',
  ) {
    super(code);
  }
}

type ProgressDeps = StartDeps & { progress: VisaRenewalProgressRepository };
type MutationInput = { idempotencyKey: string; requestHash: string };

async function replay<T>(
  deps: ProgressDeps,
  actor: Actor,
  operation: string,
  input: MutationInput,
): Promise<T | null> {
  const found = await deps.idempotency.findIdempotency<T>(
    actor.tenantId,
    operation,
    input.idempotencyKey,
  );
  if (found && found.requestHash !== input.requestHash)
    throw new VisaRenewalValidationError('IDEMPOTENCY_KEY_REUSED');
  return found?.response ?? null;
}
async function workflowOrThrow(
  deps: ProgressDeps,
  actor: Actor,
  caseId: string,
  workflowId: string,
): Promise<VisaRenewalWorkflow> {
  const workflow = await deps.workflows.find(actor.tenantId, workflowId);
  if (!workflow || workflow.employmentCaseId !== caseId)
    throw new VisaRenewalValidationError('WORKFLOW_NOT_FOUND');
  return workflow;
}
async function permit(
  deps: ProgressDeps,
  actor: Actor,
  caseId: string,
  workflowId: string,
  action: string,
): Promise<void> {
  await authorizeOrThrow(deps, actor, {
    resourceType: 'workflow',
    action,
    caseId,
    resourceId: workflowId,
    sensitivity: 'identity_sensitive',
  });
}

export interface RecordVisaRenewalContactInput extends MutationInput {
  workflowStepId?: string | null;
  organizationId?: string | null;
  contactId?: string | null;
  channel: 'phone' | 'email' | 'whatsapp' | 'meeting' | 'letter' | 'sms' | 'portal';
  occurredAt: string;
  purpose: string;
  outcome: string;
  followUpAt?: string | null;
  confirmationStatus: 'not_requested' | 'pending' | 'confirmed';
  sensitivity: 'general' | 'employment_sensitive' | 'identity_sensitive';
  visibility: 'tenant' | 'case';
}
export class RecordVisaRenewalContactActivity {
  constructor(private readonly deps: ProgressDeps) {}
  async execute(
    actor: Actor,
    caseId: string,
    workflowId: string,
    input: RecordVisaRenewalContactInput,
  ) {
    await permit(this.deps, actor, caseId, workflowId, 'update');
    const existing = await replay<{ activityId: string }>(
      this.deps,
      actor,
      'visa_renewal.contact.record',
      input,
    );
    if (existing) return existing;
    await workflowOrThrow(this.deps, actor, caseId, workflowId);
    const result = { activityId: this.deps.ids.next() };
    await this.deps.progress.recordContactActivity({
      id: result.activityId,
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      workflowId,
      workflowStepId: input.workflowStepId ?? null,
      organizationId: input.organizationId ?? null,
      contactId: input.contactId ?? null,
      channel: input.channel,
      occurredAt: input.occurredAt,
      purpose: input.purpose,
      outcome: input.outcome,
      followUpAt: input.followUpAt ?? null,
      confirmationStatus: input.confirmationStatus,
      sensitivity: input.sensitivity,
      visibility: input.visibility,
      recordedBy: actor.userId,
    });
    if (this.deps.sideEffects)
      await this.deps.sideEffects.record({
        tenantId: actor.tenantId,
        employmentCaseId: caseId,
        workflowId,
        actorId: actor.userId,
        correlationId: actor.correlationId,
        occurredAt: this.deps.clock.now().toISOString(),
        action: 'visa_renewal.contact_recorded',
        sensitivity: input.sensitivity,
      });
    await this.deps.idempotency.saveIdempotency(actor.tenantId, {
      operation: 'visa_renewal.contact.record',
      key: input.idempotencyKey,
      requestHash: input.requestHash,
      response: result,
    });
    return result;
  }
}

export class LinkRenewedVisaAuthorization {
  constructor(private readonly deps: ProgressDeps) {}
  async execute(
    actor: Actor,
    caseId: string,
    workflowId: string,
    input: MutationInput & { documentVersionId: string; validFrom: string; validTo: string },
  ) {
    await permit(this.deps, actor, caseId, workflowId, 'update');
    const existing = await replay<{ renewedAuthorizationId: string; overlapReviewIds: string[] }>(
      this.deps,
      actor,
      'visa_renewal.authorization.link',
      input,
    );
    if (existing) return existing;
    const workflow = await workflowOrThrow(this.deps, actor, caseId, workflowId);
    const renewedAuthorizationId = this.deps.ids.next();
    const linkage = await this.deps.progress.linkRenewedAuthorization({
      id: this.deps.ids.next(),
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      workflowId,
      priorAuthorizationId: workflow.currentAuthorizationId,
      renewedAuthorizationId,
      documentVersionId: input.documentVersionId,
      validFrom: input.validFrom,
      validUntil: input.validTo,
      linkedBy: actor.userId,
      linkedAt: this.deps.clock.now().toISOString(),
    });
    const result = { renewedAuthorizationId, overlapReviewIds: linkage.overlapReviewIds };
    if (this.deps.sideEffects)
      await this.deps.sideEffects.record({
        tenantId: actor.tenantId,
        employmentCaseId: caseId,
        workflowId,
        actorId: actor.userId,
        correlationId: actor.correlationId,
        occurredAt: this.deps.clock.now().toISOString(),
        action: 'visa_renewal.authorization_linked',
        sensitivity: 'identity_sensitive',
      });
    await this.deps.idempotency.saveIdempotency(actor.tenantId, {
      operation: 'visa_renewal.authorization.link',
      key: input.idempotencyKey,
      requestHash: input.requestHash,
      response: result,
    });
    return result;
  }
}

export class ResolveVisaAuthorizationOverlap {
  constructor(private readonly deps: ProgressDeps) {}
  async execute(
    actor: Actor,
    caseId: string,
    workflowId: string,
    reviewId: string,
    input: MutationInput & { resolutionCode: string },
  ) {
    await permit(this.deps, actor, caseId, workflowId, 'update');
    const existing = await replay<{ reviewId: string; status: 'resolved' }>(
      this.deps,
      actor,
      'visa_renewal.overlap.resolve',
      input,
    );
    if (existing) return existing;
    await workflowOrThrow(this.deps, actor, caseId, workflowId);
    const result = { reviewId, status: 'resolved' as const };
    await this.deps.progress.resolveOverlapReview({
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      workflowId,
      reviewId,
      resolutionCode: input.resolutionCode,
      reviewedBy: actor.userId,
      reviewedAt: this.deps.clock.now().toISOString(),
    });
    if (this.deps.sideEffects)
      await this.deps.sideEffects.record({
        tenantId: actor.tenantId,
        employmentCaseId: caseId,
        workflowId,
        actorId: actor.userId,
        correlationId: actor.correlationId,
        occurredAt: this.deps.clock.now().toISOString(),
        action: 'visa_renewal.overlap_review_resolved',
        sensitivity: 'identity_sensitive',
      });
    await this.deps.idempotency.saveIdempotency(actor.tenantId, {
      operation: 'visa_renewal.overlap.resolve',
      key: input.idempotencyKey,
      requestHash: input.requestHash,
      response: result,
    });
    return result;
  }
}

export class CompleteVisaRenewalWorkflow {
  constructor(private readonly deps: ProgressDeps) {}
  async execute(
    actor: Actor,
    caseId: string,
    workflowId: string,
    input: MutationInput & { taskId: string },
  ) {
    await permit(this.deps, actor, caseId, workflowId, 'complete');
    const existing = await replay<VisaRenewalWorkflow>(
      this.deps,
      actor,
      'visa_renewal.complete',
      input,
    );
    if (existing) return existing;
    await workflowOrThrow(this.deps, actor, caseId, workflowId);
    const now = this.deps.clock.now().toISOString();
    try {
      await this.deps.progress.complete({
        id: this.deps.ids.next(),
        tenantId: actor.tenantId,
        employmentCaseId: caseId,
        workflowId,
        taskId: input.taskId,
        timelineEventId: this.deps.ids.next(),
        auditEventId: this.deps.ids.next(),
        completedBy: actor.userId,
        completedAt: now,
        correlationId: actor.correlationId,
      });
    } catch {
      throw new VisaRenewalValidationError('COMPLETION_INVALID');
    }
    const result = await workflowOrThrow(this.deps, actor, caseId, workflowId);
    await this.deps.idempotency.saveIdempotency(actor.tenantId, {
      operation: 'visa_renewal.complete',
      key: input.idempotencyKey,
      requestHash: input.requestHash,
      response: result,
    });
    return result;
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

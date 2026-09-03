import type { RaciRole, SensitivityClass, WorkflowInstanceStatus } from '@caredesk/domain';

export interface VisaRuleEvaluation {
  ruleDefinitionId: string;
  ruleVersionId: string;
  status: 'active' | 'unverified' | 'conflicting' | 'unavailable';
  asOf: string;
  dueDate: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent' | null;
  explanationKey: string;
  sourceReferences: readonly string[];
  reviewRequired: boolean;
}

export interface VisaWorkflowAssignment {
  stepKey: string;
  raciRole: RaciRole;
  assigneeType: 'user' | 'contact';
  assigneeId: string;
}

export interface VisaWorkflowBlocker {
  code:
    | 'missing_primary_licensed_bureau_contact'
    | 'overlapping_authorization'
    | 'unverified_evidence'
    | 'professional_review_required';
  stepKey: string;
  ownerAssignmentId: string | null;
  nextReviewAt: string | null;
}

export interface VisaRenewalWorkflow {
  id: string;
  tenantId: string;
  employmentCaseId: string;
  templateVersionId: string;
  currentAuthorizationId: string;
  status: WorkflowInstanceStatus;
  evaluation: VisaRuleEvaluation;
  assignments: readonly VisaWorkflowAssignment[];
  blockers: readonly VisaWorkflowBlocker[];
  linkedRenewedAuthorizationId: string | null;
  linkedDocumentVersionId: string | null;
  completedAt: string | null;
}

export interface StartVisaRenewalRecord extends Omit<
  VisaRenewalWorkflow,
  | 'id'
  | 'status'
  | 'blockers'
  | 'linkedRenewedAuthorizationId'
  | 'linkedDocumentVersionId'
  | 'completedAt'
> {
  id: string;
}

export interface VisaRenewalRepository {
  start(input: StartVisaRenewalRecord): Promise<VisaRenewalWorkflow>;
  find(tenantId: string, workflowId: string): Promise<VisaRenewalWorkflow | null>;
  listByCase(tenantId: string, employmentCaseId: string): Promise<VisaRenewalWorkflow[]>;
}

export interface VisaRenewalContactActivityRecord {
  id: string;
  tenantId: string;
  employmentCaseId: string;
  workflowId: string;
  workflowStepId: string | null;
  organizationId: string | null;
  contactId: string | null;
  channel: 'phone' | 'email' | 'whatsapp' | 'meeting' | 'letter' | 'sms' | 'portal';
  occurredAt: string;
  purpose: string;
  outcome: string;
  followUpAt: string | null;
  confirmationStatus: 'not_requested' | 'pending' | 'confirmed';
  sensitivity: SensitivityClass;
  visibility: 'tenant' | 'case';
  recordedBy: string;
}

export interface RenewedAuthorizationLinkRecord {
  id: string;
  tenantId: string;
  employmentCaseId: string;
  workflowId: string;
  priorAuthorizationId: string;
  renewedAuthorizationId: string;
  documentVersionId: string;
  validFrom: string;
  validUntil: string;
  linkedBy: string;
  linkedAt: string;
}

export interface AuthorizationOverlapReviewRecord {
  id: string;
  tenantId: string;
  employmentCaseId: string;
  workflowId: string;
  firstAuthorizationId: string;
  secondAuthorizationId: string;
}

export interface ResolveAuthorizationOverlapReviewRecord {
  tenantId: string;
  employmentCaseId: string;
  workflowId: string;
  reviewId: string;
  resolutionCode: string;
  reviewedBy: string;
  reviewedAt: string;
}

export interface CompleteVisaRenewalRecord {
  id: string;
  tenantId: string;
  employmentCaseId: string;
  workflowId: string;
  taskId: string;
  timelineEventId: string;
  auditEventId: string;
  completedBy: string;
  completedAt: string;
  correlationId: string;
}

/** Atomic persistence commands used by the remaining Visa Renewal use cases. */
export interface VisaRenewalProgressRepository {
  recordContactActivity(input: VisaRenewalContactActivityRecord): Promise<void>;
  linkRenewedAuthorization(
    input: RenewedAuthorizationLinkRecord,
  ): Promise<{ overlapReviewIds: string[] }>;
  openOverlapReview(input: AuthorizationOverlapReviewRecord): Promise<void>;
  resolveOverlapReview(input: ResolveAuthorizationOverlapReviewRecord): Promise<void>;
  complete(input: CompleteVisaRenewalRecord): Promise<void>;
}

export interface VisaRenewalSideEffects {
  record(event: {
    tenantId: string;
    employmentCaseId: string;
    workflowId: string;
    actorId: string;
    correlationId: string;
    occurredAt: string;
    action: string;
    sensitivity: SensitivityClass;
  }): Promise<void>;
}

/** Resolves governed rule output server-side; callers can never supply legal truth. */
export interface VisaRenewalEvaluationRepository {
  evaluate(asOf: string): Promise<VisaRuleEvaluation>;
}

/** One selectable step belonging to an approved-and-active template version. */
export interface WorkflowTemplateStepOption {
  stepKey: string;
  titleKey: string;
  position: number;
}

/**
 * A workflow template version a family can actually start a renewal from —
 * only `status = 'active'` versions are returned (the same status the start
 * use case itself requires; see visa-renewal-repository.ts `start()`), so
 * nothing shown here can be rejected by the server for being unapproved.
 */
export interface WorkflowTemplateOption {
  templateVersionId: string;
  templateKey: string;
  nameKey: string;
  version: number;
  steps: readonly WorkflowTemplateStepOption[];
}

/** Global regulatory reference data (no tenant_id — same shape as visa rule tables). */
export interface WorkflowTemplateRepository {
  listActive(): Promise<WorkflowTemplateOption[]>;
}

/** One `employment_authorization` row a family can point a renewal at. */
export interface CaseAuthorizationOption {
  id: string;
  status: 'current' | 'renewed' | 'expired' | 'cancelled';
  validFrom: string | null;
  validUntil: string | null;
}

export interface CaseAuthorizationRepository {
  listByCase(tenantId: string, employmentCaseId: string): Promise<CaseAuthorizationOption[]>;
}

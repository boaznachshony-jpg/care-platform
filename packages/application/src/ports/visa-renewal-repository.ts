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

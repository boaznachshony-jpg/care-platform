export const CASE_ACTIONS = [
  'open_document',
  'upload_document',
  'create_task',
  'create_checklist',
  'open_visa_renewal',
  'open_payroll',
  'open_monthly_close',
  'request_professional_review',
] as const;
export type CaseAction = (typeof CASE_ACTIONS)[number];
export type CaseAssistantIntent =
  'travel_check' | 'missing_file_facts' | 'explain_attention' | 'checklist';

export interface CaseContextSnapshot {
  caseSummary: { caseId: string; status: string };
  caregiverSummary?: { displayName: string };
  authorizationSummary?: { expiresAt: string | null };
  documentStatusSummary: {
    documentId: string;
    type: string;
    expiresAt: string | null;
    status: string;
  }[];
  insuranceSummary?: { expiresAt: string | null };
  payrollStatusSummary?: { latestMonth: string; closed: boolean };
  activeTasks: { id: string; title: string; dueAt: string | null }[];
  relevantTimelineEvents: { id: string; type: string; occurredAt: string }[];
  activeWorkflowSummary?: { id: string; type: string; step: string };
  relevantApprovedRules: { id: string; version: string; title: string }[];
}

export interface CaseAssistantResponse {
  answer: string;
  factsUsed: { factPath: string; label: string }[];
  uncertainties: {
    code: 'missing_fact' | 'conflicting_fact' | 'no_approved_rule' | 'professional_interpretation';
    message: string;
  }[];
  recommendedActions: { type: CaseAction; label: string; mutatesCase: boolean }[];
  proposedChecklist?: string[];
  escalation?: { required: boolean; reason: string };
}

export function buildCaseContext(
  intent: CaseAssistantIntent,
  source: CaseContextSnapshot,
): CaseContextSnapshot {
  const common = {
    caseSummary: source.caseSummary,
    documentStatusSummary: source.documentStatusSummary,
    activeTasks: source.activeTasks,
    relevantTimelineEvents: source.relevantTimelineEvents,
    relevantApprovedRules: source.relevantApprovedRules,
  };
  if (intent === 'travel_check')
    return {
      ...common,
      caregiverSummary: source.caregiverSummary,
      authorizationSummary: source.authorizationSummary,
      insuranceSummary: source.insuranceSummary,
      activeWorkflowSummary: source.activeWorkflowSummary,
    };
  if (intent === 'missing_file_facts')
    return { ...common, caregiverSummary: source.caregiverSummary };
  return {
    ...common,
    activeWorkflowSummary: source.activeWorkflowSummary,
    payrollStatusSummary: source.payrollStatusSummary,
  };
}

export function validateAssistantResponse(
  response: CaseAssistantResponse,
  context: CaseContextSnapshot,
): CaseAssistantResponse {
  const allowedPaths = new Set<string>();
  const walk = (value: unknown, path: string) => {
    if (value && typeof value === 'object')
      Object.entries(value).forEach(([key, child]) => walk(child, path ? `${path}.${key}` : key));
    else allowedPaths.add(path.replace(/\.\d+\./g, '.'));
  };
  walk(context, '');
  if (response.factsUsed.some((fact) => !allowedPaths.has(fact.factPath.replace(/\.\d+\./g, '.'))))
    throw new Error('assistant_fact_not_in_context');
  if (response.recommendedActions.some((action) => !CASE_ACTIONS.includes(action.type)))
    throw new Error('assistant_action_unsupported');
  return response;
}

export function requiresConfirmation(response: CaseAssistantResponse): boolean {
  return response.recommendedActions.some((action) => action.mutatesCase);
}

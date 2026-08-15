export type ResponsibilityKind =
  | 'case_management'
  | 'payroll'
  | 'documents_compliance'
  | 'visa_authorization'
  | 'insurance'
  | 'general_administration';

export interface SharedPaymentFact {
  closeId: string;
  caseId: string;
  workerId: string;
  month: string;
  status: 'draft' | 'closed';
  amountPaid: number;
  paymentDate?: string;
  paymentMethod?: string;
  evidenceAvailable: boolean;
  acknowledgedAt?: string;
}

export interface SharedPaymentProjection {
  closeId: string;
  month: string;
  status: 'closed';
  amountPaid: number;
  paymentDate: string;
  paymentMethod?: string;
  evidenceAvailable: boolean;
  acknowledgement: 'pending' | 'acknowledged';
  acknowledgedAt?: string;
}

/** One canonical projection powers both surfaces; only the final field policy differs. */
export function projectSharedPayments(input: {
  caseId: string;
  workerId: string;
  facts: readonly SharedPaymentFact[];
}): SharedPaymentProjection[] {
  return input.facts
    .filter(
      (fact) =>
        fact.caseId === input.caseId &&
        fact.workerId === input.workerId &&
        fact.status === 'closed' &&
        Boolean(fact.paymentDate),
    )
    .map((fact) => ({
      closeId: fact.closeId,
      month: fact.month,
      status: 'closed' as const,
      amountPaid: fact.amountPaid,
      paymentDate: fact.paymentDate!,
      ...(fact.paymentMethod ? { paymentMethod: fact.paymentMethod } : {}),
      evidenceAvailable: fact.evidenceAvailable,
      acknowledgement: fact.acknowledgedAt ? ('acknowledged' as const) : ('pending' as const),
      ...(fact.acknowledgedAt ? { acknowledgedAt: fact.acknowledgedAt } : {}),
    }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

export interface LeaveFact {
  id: string;
  caseId: string;
  workerId: string;
  startDate: string;
  endDate: string;
  days: number;
  status: 'pending' | 'approved' | 'rejected' | 'used';
}

export function projectSharedLeave(input: {
  caseId: string;
  workerId: string;
  governedAvailableBalance?: number;
  facts: readonly LeaveFact[];
}) {
  const history = input.facts
    .filter((fact) => fact.caseId === input.caseId && fact.workerId === input.workerId)
    .filter((fact) => fact.days > 0 && fact.startDate <= fact.endDate)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  return {
    // Absence means no approved rule supplied a balance; never invent entitlement.
    availableBalance: input.governedAvailableBalance ?? null,
    used: history
      .filter((fact) => fact.status === 'used')
      .reduce((sum, fact) => sum + fact.days, 0),
    planned: history
      .filter((fact) => fact.status === 'approved')
      .reduce((sum, fact) => sum + fact.days, 0),
    pending: history.filter((fact) => fact.status === 'pending'),
    history,
  };
}

export type CollaborationAttentionKind = 'case_risk' | 'collaboration_task' | 'communication_issue';

export function assertAssignableMember(input: {
  actorRole: string;
  tenantId: string;
  assigneeTenantId: string;
  assigneeStatus: string;
}): void {
  if (!['owner', 'manager'].includes(input.actorRole)) throw new Error('manager_required');
  if (input.tenantId !== input.assigneeTenantId || input.assigneeStatus !== 'active') {
    throw new Error('invalid_assignee');
  }
}

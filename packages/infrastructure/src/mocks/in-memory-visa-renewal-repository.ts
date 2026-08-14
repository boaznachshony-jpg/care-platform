import type {
  IdempotencyRecord,
  IdempotencyRepository,
  StartVisaRenewalRecord,
  VisaRenewalRepository,
  VisaRenewalProgressRepository,
  VisaRenewalWorkflow,
} from '@caredesk/application';

export class InMemoryVisaRenewalRepository
  implements VisaRenewalRepository, IdempotencyRepository, VisaRenewalProgressRepository
{
  private readonly workflows = new Map<string, VisaRenewalWorkflow>();
  private readonly replay = new Map<string, IdempotencyRecord<unknown>>();
  async start(input: StartVisaRenewalRecord): Promise<VisaRenewalWorkflow> {
    const row: VisaRenewalWorkflow = {
      ...input,
      status: 'active',
      blockers: [],
      linkedRenewedAuthorizationId: null,
      linkedDocumentVersionId: null,
      completedAt: null,
    };
    this.workflows.set(row.id, row);
    return row;
  }
  async find(tenantId: string, id: string): Promise<VisaRenewalWorkflow | null> {
    const row = this.workflows.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async listByCase(tenantId: string, caseId: string): Promise<VisaRenewalWorkflow[]> {
    return [...this.workflows.values()].filter(
      (x) => x.tenantId === tenantId && x.employmentCaseId === caseId,
    );
  }
  async findIdempotency<T>(
    tenantId: string,
    operation: string,
    key: string,
  ): Promise<IdempotencyRecord<T> | null> {
    return (
      (this.replay.get(`${tenantId}:${operation}:${key}`) as IdempotencyRecord<T> | undefined) ??
      null
    );
  }
  async saveIdempotency<T>(tenantId: string, record: IdempotencyRecord<T>): Promise<void> {
    this.replay.set(`${tenantId}:${record.operation}:${record.key}`, record);
  }
  async recordContactActivity(): Promise<void> {}
  async linkRenewedAuthorization(
    input: Parameters<VisaRenewalProgressRepository['linkRenewedAuthorization']>[0],
  ): Promise<{ overlapReviewIds: string[] }> {
    const row = this.workflows.get(input.workflowId);
    if (!row || row.tenantId !== input.tenantId || row.employmentCaseId !== input.employmentCaseId)
      throw new Error('Invalid workflow');
    this.workflows.set(row.id, {
      ...row,
      linkedRenewedAuthorizationId: input.renewedAuthorizationId,
      linkedDocumentVersionId: input.documentVersionId,
    });
    return { overlapReviewIds: [] };
  }
  async openOverlapReview(): Promise<void> {}
  async resolveOverlapReview(): Promise<void> {}
  async complete(input: Parameters<VisaRenewalProgressRepository['complete']>[0]): Promise<void> {
    const row = this.workflows.get(input.workflowId);
    if (!row || !row.linkedRenewedAuthorizationId || row.blockers.length)
      throw new Error('Invalid completion');
    this.workflows.set(row.id, { ...row, status: 'completed', completedAt: input.completedAt });
  }
}

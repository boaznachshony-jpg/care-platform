import type {
  IdempotencyRecord,
  IdempotencyRepository,
  StartVisaRenewalRecord,
  VisaRenewalRepository,
  VisaRenewalWorkflow,
} from '@caredesk/application';

export class InMemoryVisaRenewalRepository implements VisaRenewalRepository, IdempotencyRepository {
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
}

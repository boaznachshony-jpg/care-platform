import type { CaseFoundationRepository, EmploymentCaseGraph } from '@caredesk/application';

/**
 * Tenant-scoped in-memory persistence for Milestone 1. Every lookup requires
 * the tenantId — mirroring the RLS behavior the SQL schema enforces, so
 * swapping in the Postgres adapter later changes no calling code.
 */
export class InMemoryCaseFoundationRepository implements CaseFoundationRepository {
  private readonly graphsByTenant = new Map<string, Map<string, EmploymentCaseGraph>>();

  async createCaseGraph(graph: EmploymentCaseGraph): Promise<void> {
    const tenantId = graph.employmentCase.tenantId;
    const parties = [graph.careRecipient, graph.employer, graph.caregiver];
    if (parties.some((party) => party.tenantId !== tenantId)) {
      throw new Error('Cross-tenant case graph rejected.');
    }

    const tenantGraphs =
      this.graphsByTenant.get(tenantId) ?? new Map<string, EmploymentCaseGraph>();
    tenantGraphs.set(graph.employmentCase.id, graph);
    this.graphsByTenant.set(tenantId, tenantGraphs);
  }

  async findCaseGraph(tenantId: string, caseId: string): Promise<EmploymentCaseGraph | null> {
    return this.graphsByTenant.get(tenantId)?.get(caseId) ?? null;
  }

  async listCaseGraphs(tenantId: string): Promise<EmploymentCaseGraph[]> {
    return Array.from(this.graphsByTenant.get(tenantId)?.values() ?? []);
  }
}

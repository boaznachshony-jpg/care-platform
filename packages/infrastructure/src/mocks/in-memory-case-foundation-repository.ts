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

    // Mirrors employment_case_legacy_client_unique (migration 0042). DB-15 in
    // the code review is exactly this class of gap: a mock that enforces none
    // of the database's protective constraints turns a production-only failure
    // into a green test. A second case for one legacy client is the duplicate
    // this whole link exists to prevent, so the mock refuses it too.
    const legacyClientId = graph.employmentCase.legacyClientId;
    if (
      legacyClientId !== null &&
      [...tenantGraphs.values()].some(
        (existing) => existing.employmentCase.legacyClientId === legacyClientId,
      )
    ) {
      throw new Error('Duplicate legacy client link rejected.');
    }

    tenantGraphs.set(graph.employmentCase.id, graph);
    this.graphsByTenant.set(tenantId, tenantGraphs);
  }

  async findCaseGraph(tenantId: string, caseId: string): Promise<EmploymentCaseGraph | null> {
    return this.graphsByTenant.get(tenantId)?.get(caseId) ?? null;
  }

  async findCaseGraphByLegacyClientId(
    tenantId: string,
    legacyClientId: string,
  ): Promise<EmploymentCaseGraph | null> {
    for (const graph of this.graphsByTenant.get(tenantId)?.values() ?? []) {
      if (graph.employmentCase.legacyClientId === legacyClientId) return graph;
    }
    return null;
  }

  async listCaseGraphs(tenantId: string): Promise<EmploymentCaseGraph[]> {
    return Array.from(this.graphsByTenant.get(tenantId)?.values() ?? []);
  }
}

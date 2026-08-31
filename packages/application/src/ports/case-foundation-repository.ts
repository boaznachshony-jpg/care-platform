import type { CareRecipient, Caregiver, Employer, EmploymentCase } from '@caredesk/domain';

/**
 * Milestone 1 aggregate persistence port. Creating a case creates its three
 * party records atomically (blueprint §15: transactions for multi-entity
 * business operations) — the port exposes the graph, not four separate
 * repositories, so no caller can create half a case.
 */
export interface EmploymentCaseGraph {
  employmentCase: EmploymentCase;
  careRecipient: CareRecipient;
  employer: Employer;
  caregiver: Caregiver;
}

export interface CaseFoundationRepository {
  createCaseGraph(graph: EmploymentCaseGraph): Promise<void>;
  findCaseGraph(tenantId: string, caseId: string): Promise<EmploymentCaseGraph | null>;
  /**
   * The case opened for a legacy browser client, or null.
   *
   * This is what makes opening a case idempotent per local client (ADR-006,
   * migration 0042). Onboarding can complete twice, a failed request can be
   * retried, and two tabs can race; without this lookup each of those creates a
   * second canonical case for the same household, and the product then has to
   * guess which one is real.
   */
  findCaseGraphByLegacyClientId(
    tenantId: string,
    legacyClientId: string,
  ): Promise<EmploymentCaseGraph | null>;
  listCaseGraphs(tenantId: string): Promise<EmploymentCaseGraph[]>;
}

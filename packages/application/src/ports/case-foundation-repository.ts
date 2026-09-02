import type { CareRecipient, Caregiver, Employer, EmploymentCase } from '@caredesk/domain';

/**
 * Only the fields a family may edit after intake. `caregiverPassportNumber`
 * from the browser-only profile (apps/web/src/storage/mvp-storage.ts) is
 * deliberately not one of them: migration 0003 already decided that
 * identity credentials are not plaintext columns on `caregiver`, and a
 * passport is already representable as a `document` (document_type =
 * 'passport', owner_type = 'caregiver') — the existing upload path, not a new
 * field here.
 */
export interface UpdateCaregiverProfile {
  legalName?: string;
  preferredName?: string | null;
  nationality?: string;
  primaryLanguage?: string | null;
}

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
  /** Returns null when the caregiver does not exist or is in another tenant. */
  updateCaregiver(
    tenantId: string,
    caregiverId: string,
    changes: UpdateCaregiverProfile,
  ): Promise<Caregiver | null>;
}

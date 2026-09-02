import type { DocumentType } from '@caredesk/domain';

/**
 * The critical-detail set a freshly opened case seeds an open task for, and
 * the same set a valid document auto-closes. Shared between
 * OpenEmploymentCase (seeding) and manage-case-documents.ts (auto-completion)
 * so the two can never drift into naming two different "passport" keys.
 *
 * This is deliberately the SAME three facts `/cases/:caseId/health` already
 * treats as governing factors (apps/api/src/routes/product-differentiation.ts:
 * passport, visa/authorization, medical insurance — each weighted 25 of 100).
 * See open-employment-case.ts for the fuller rationale of why these three and
 * only these three are load-bearing enough to seed a task for.
 */
export interface CaseHealthTaskFactor {
  /** The Document.documentType a valid document must carry to satisfy this factor. */
  documentType: DocumentType;
  /** task.source_key (migration 0047) — stable per case, the seeding/completion idempotency key. */
  sourceKey: string;
  /** Rendered through the translated-titleKey path — see CreateTaskRecord.titleKey. */
  titleKey: string;
}

export const CASE_HEALTH_TASK_FACTORS: readonly CaseHealthTaskFactor[] = [
  {
    documentType: 'passport',
    sourceKey: 'case_health:passport',
    titleKey: 'tasks.seeded.passport',
  },
  { documentType: 'visa', sourceKey: 'case_health:visa', titleKey: 'tasks.seeded.visa' },
  {
    // 'medical_insurance' is the factor/task's own name for this fact, not a
    // real Document.documentType (DOCUMENT_TYPES has no such member — see
    // packages/domain/src/status.ts). 'insurance_policy' is the actual legal
    // value a medical-insurance document is stored under; the health route
    // (apps/api/src/routes/product-differentiation.ts) previously compared
    // against the literal string 'medical_insurance' directly, which could
    // never match a real document and left that factor permanently dead.
    // Fixed alongside this change since both now read from this one list.
    documentType: 'insurance_policy',
    sourceKey: 'case_health:medical_insurance',
    titleKey: 'tasks.seeded.medicalInsurance',
  },
];

/** The factor a document of this type would satisfy, or undefined if this document type is not governed. */
export function findCaseHealthTaskFactor(
  documentType: DocumentType,
): CaseHealthTaskFactor | undefined {
  return CASE_HEALTH_TASK_FACTORS.find((factor) => factor.documentType === documentType);
}

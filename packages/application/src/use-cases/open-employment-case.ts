import { brandId, type EmploymentCase } from '@caredesk/domain';
import type { AuditService } from '../ports/audit-service.js';
import type { AuthorizationService } from '../ports/authorization-service.js';
import type {
  CaseFoundationRepository,
  EmploymentCaseGraph,
} from '../ports/case-foundation-repository.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { TimelineService } from '../ports/timeline-service.js';
import { type Actor } from './actor.js';
import { authorizeOrThrow } from './authorize.js';

// Re-exported so existing imports of Actor/AuthorizationError from this module
// keep working; both now live in ./actor.js to keep authorize.js cycle-free.
export { AuthorizationError, type Actor } from './actor.js';

export interface OpenEmploymentCaseInput {
  careRecipient: { fullName: string; careLevel?: string; city?: string };
  employer: { fullName: string; relationshipToRecipient: string; city?: string };
  caregiver: {
    legalName: string;
    preferredName?: string;
    nationality: string;
    primaryLanguage?: string;
  };
  startDate: string;
  /**
   * The legacy browser client this case is being opened for (ADR-006
   * provenance). Present when case creation is driven from the end of
   * onboarding; absent when a case is opened directly in the canonical product.
   */
  legacyClientId?: string;
}

export interface OpenEmploymentCaseDeps {
  authorization: AuthorizationService;
  repository: CaseFoundationRepository;
  audit: AuditService;
  timeline: TimelineService;
  clock: Clock;
  ids: IdGenerator;
}

/**
 * Milestone 1 core use case. Order matters: authorize first (deny-by-default,
 * Constitution §18), persist the full graph atomically, then audit + timeline
 * (§19 — case creation is a mandatory audit event).
 */
export class OpenEmploymentCase {
  constructor(private readonly deps: OpenEmploymentCaseDeps) {}

  async execute(actor: Actor, input: OpenEmploymentCaseInput): Promise<EmploymentCase> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'employment_case',
      action: 'create',
      sensitivity: 'employment_sensitive',
    });

    // Idempotence before creation. Onboarding is completed more than once in
    // practice - a retry after a failed request, a second tab, a customer who
    // walks back through the wizard - and each of those used to be a second
    // canonical case for one household. Returning the existing case makes the
    // call safe to repeat, which is what lets the web client retry it freely
    // instead of recording "did I already do this?" in the legacy snapshot.
    //
    // This returns early on purpose: no second audit or timeline entry, because
    // nothing happened. The unique index in migration 0042 is the second line
    // for the case where two requests pass this check concurrently.
    if (input.legacyClientId) {
      const existing = await this.deps.repository.findCaseGraphByLegacyClientId(
        actor.tenantId,
        input.legacyClientId,
      );
      if (existing) return existing.employmentCase;
    }

    const now = this.deps.clock.now().toISOString();
    const graph: EmploymentCaseGraph = {
      careRecipient: {
        id: brandId(this.deps.ids.next()),
        tenantId: brandId(actor.tenantId),
        fullName: input.careRecipient.fullName,
        careLevel: input.careRecipient.careLevel ?? null,
        city: input.careRecipient.city ?? null,
      },
      employer: {
        id: brandId(this.deps.ids.next()),
        tenantId: brandId(actor.tenantId),
        fullName: input.employer.fullName,
        relationshipToRecipient: input.employer.relationshipToRecipient,
        city: input.employer.city ?? null,
      },
      caregiver: {
        id: brandId(this.deps.ids.next()),
        tenantId: brandId(actor.tenantId),
        legalName: input.caregiver.legalName,
        preferredName: input.caregiver.preferredName ?? null,
        nationality: input.caregiver.nationality,
        primaryLanguage: input.caregiver.primaryLanguage ?? null,
        status: 'active',
      },
      employmentCase: {
        id: brandId(this.deps.ids.next()),
        tenantId: brandId(actor.tenantId),
        careRecipientId: brandId(''),
        employerId: brandId(''),
        caregiverId: brandId(''),
        startDate: input.startDate,
        endDate: null,
        status: 'draft',
        legacyClientId: input.legacyClientId ?? null,
      },
    };
    graph.employmentCase.careRecipientId = graph.careRecipient.id;
    graph.employmentCase.employerId = graph.employer.id;
    graph.employmentCase.caregiverId = graph.caregiver.id;

    await this.deps.repository.createCaseGraph(graph);

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'employment_case.opened',
      resourceType: 'employment_case',
      resourceId: graph.employmentCase.id,
      correlationId: actor.correlationId,
      occurredAt: now,
      changeSummary: 'Employment case opened with care recipient, employer, and caregiver.',
      sensitivity: 'employment_sensitive',
    });

    await this.deps.timeline.record({
      tenantId: actor.tenantId,
      employmentCaseId: graph.employmentCase.id,
      eventTypeKey: 'timeline.case.opened',
      occurredAt: now,
      summaryKey: 'timeline.case.opened.summary',
      sensitivity: 'general',
    });

    return graph.employmentCase;
  }
}

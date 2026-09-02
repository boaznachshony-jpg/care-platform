import { brandId, type EmploymentCase } from '@caredesk/domain';
import type { AuditService } from '../ports/audit-service.js';
import type { AuthorizationService } from '../ports/authorization-service.js';
import type {
  CaseFoundationRepository,
  EmploymentCaseGraph,
} from '../ports/case-foundation-repository.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { TimelineService } from '../ports/timeline-service.js';
import { type Actor } from './actor.js';
import { authorizeOrThrow } from './authorize.js';

// Re-exported so existing imports of Actor/AuthorizationError from this module
// keep working; both now live in ./actor.js to keep authorize.js cycle-free.
export { AuthorizationError, type Actor } from './actor.js';

/**
 * The critical-detail set a freshly opened case seeds an open task for.
 *
 * This is deliberately the SAME three facts `/cases/:caseId/health` already
 * treats as governing factors (apps/api/src/routes/product-differentiation.ts:
 * passport, visa/authorization, medical insurance — each weighted 25 of 100).
 * That is not a coincidence: the product already decided these three, and
 * only these three, are load-bearing enough to score a case's health on. A
 * task list that seeded a task for every optional field would train families
 * to ignore it; reusing the exact set already proven load-bearing elsewhere
 * keeps the list short and every item on it real.
 *
 * sourceKey is the idempotency key (migration 0047's task.source_key,
 * modelled on task.legacy_local_id from migration 0046): stable, scoped per
 * case by the unique index, so seeding never duplicates on a retry or a case
 * reopened later. titleKey (not title) because this task is a server
 * decision, not user-typed text — it renders through the same
 * translated-titleKey path Milestone-2 workflow tasks already use.
 *
 * Self-resolution — i.e. the task disappearing/completing once the caregiver's
 * passport, visa, or insurance document is actually uploaded and verified —
 * is NOT wired up here. That requires a hook in the document upload/
 * verification path (a different use case, out of this change's narrow
 * scope) and is left as explicit future work; today the family closes the
 * task themselves once the detail is on file, same as any other task.
 */
const CASE_HEALTH_TASK_FACTORS: ReadonlyArray<{ sourceKey: string; titleKey: string }> = [
  { sourceKey: 'case_health:passport', titleKey: 'tasks.seeded.passport' },
  { sourceKey: 'case_health:visa', titleKey: 'tasks.seeded.visa' },
  { sourceKey: 'case_health:medical_insurance', titleKey: 'tasks.seeded.medicalInsurance' },
];

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
  tasks: TaskRepository;
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
        // Product decision (2026-09-02, product owner): "saving IS the file."
        // A case used to be born 'draft' and nothing in the product ever
        // transitioned it out, so every case showed "טיוטה" forever, on
        // purpose or not. Withholding "active" until every field is filled
        // is not this product's model: the customer decides what to record
        // and what to leave out, the same way saving an Excel file does not
        // ask permission first. A missing critical detail is not a reason to
        // deny that the case exists — it is a reason to hand the family an
        // open task (see CASE_HEALTH_TASK_FACTORS / seedComplianceTasks
        // below), which is actionable, instead of a status badge, which is
        // not. 'draft' remains a legal value (database/migrations/0003) for
        // states this use case does not produce — it is simply no longer the
        // starting state.
        status: 'active',
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

    await this.seedComplianceTasks(actor, graph.employmentCase.id, now);

    return graph.employmentCase;
  }

  /**
   * Seeds one open task per missing critical detail (CASE_HEALTH_TASK_FACTORS
   * above). Idempotent the same way ImportCaseTask is idempotent on
   * legacyLocalId: find-by-key first (this call, on a case that was just
   * created, will never find one — this is what protects a *later* re-run,
   * e.g. a future "reopen case" action that calls this same method), then
   * rely on migration 0047's partial unique index on task.source_key as the
   * second line if two callers ever race.
   *
   * Failure here must never fail case creation — the case is already
   * persisted and returned to the caller by the time this runs. A task-seed
   * failure is logged by whatever calls this (the audit/timeline writes
   * below can throw independently already, same as the case-open ones
   * above); it does not roll back or hide the newly created case.
   */
  private async seedComplianceTasks(actor: Actor, caseId: string, now: string): Promise<void> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'task',
      action: 'create',
      caseId,
      sensitivity: 'employment_sensitive',
    });

    const seededSourceKeys: string[] = [];
    for (const factor of CASE_HEALTH_TASK_FACTORS) {
      const existing = await this.deps.tasks.findTaskBySourceKey(
        actor.tenantId,
        caseId,
        factor.sourceKey,
      );
      if (existing) continue;

      await this.deps.tasks.createTask({
        id: this.deps.ids.next(),
        tenantId: actor.tenantId,
        employmentCaseId: caseId,
        titleKey: factor.titleKey,
        description: null,
        // 'high', not 'urgent': these are real compliance gaps on a
        // brand-new case, not an emergency — every new case has all three on
        // day one, so 'urgent' on every single case would just be 'normal'
        // with extra steps.
        priority: 'high',
        dueAt: null,
        createdBy: actor.userId,
        sourceKey: factor.sourceKey,
        sourceType: 'rule',
      });
      seededSourceKeys.push(factor.sourceKey);
    }

    // Nothing to report when re-opening found every task already seeded.
    if (seededSourceKeys.length === 0) return;

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'employment_case.compliance_tasks_seeded',
      resourceType: 'employment_case',
      resourceId: caseId,
      correlationId: actor.correlationId,
      occurredAt: now,
      changeSummary: `Seeded ${seededSourceKeys.length} open task(s) for missing critical detail(s): ${seededSourceKeys.join(', ')}.`,
      sensitivity: 'employment_sensitive',
    });

    await this.deps.timeline.record({
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      eventTypeKey: 'timeline.case.compliance_tasks_seeded',
      occurredAt: now,
      summaryKey: 'timeline.case.compliance_tasks_seeded.summary',
      sensitivity: 'general',
    });
  }
}

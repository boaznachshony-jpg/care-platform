import type { AuditService } from '../ports/audit-service.js';
import type { AuthorizationService } from '../ports/authorization-service.js';
import type {
  CaseFoundationRepository,
  EmploymentCaseGraph,
} from '../ports/case-foundation-repository.js';
import type { Clock } from '../ports/clock.js';
import type { Actor } from './actor.js';
import { authorizeOrThrow } from './authorize.js';

export interface GetEmploymentCaseDeps {
  authorization: AuthorizationService;
  repository: CaseFoundationRepository;
  /** Reads authorize too, and a refused read is exactly what §19 wants recorded. */
  audit: AuditService;
  clock: Clock;
}

export class GetEmploymentCase {
  constructor(private readonly deps: GetEmploymentCaseDeps) {}

  /** Returns null for both "doesn't exist" and "exists in another tenant" — never leaks the difference. */
  async execute(actor: Actor, caseId: string): Promise<EmploymentCaseGraph | null> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'employment_case',
      action: 'read',
      caseId,
      resourceId: caseId,
      sensitivity: 'employment_sensitive',
    });

    return this.deps.repository.findCaseGraph(actor.tenantId, caseId);
  }
}

export class ListEmploymentCases {
  constructor(private readonly deps: GetEmploymentCaseDeps) {}

  async execute(actor: Actor): Promise<EmploymentCaseGraph[]> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'employment_case',
      action: 'read',
      sensitivity: 'employment_sensitive',
    });

    return this.deps.repository.listCaseGraphs(actor.tenantId);
  }
}

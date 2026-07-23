import type { AuthorizationService } from '../ports/authorization-service.js';
import type {
  CaseFoundationRepository,
  EmploymentCaseGraph,
} from '../ports/case-foundation-repository.js';
import { AuthorizationError, type Actor } from './open-employment-case.js';

export interface GetEmploymentCaseDeps {
  authorization: AuthorizationService;
  repository: CaseFoundationRepository;
}

export class GetEmploymentCase {
  constructor(private readonly deps: GetEmploymentCaseDeps) {}

  /** Returns null for both "doesn't exist" and "exists in another tenant" — never leaks the difference. */
  async execute(actor: Actor, caseId: string): Promise<EmploymentCaseGraph | null> {
    const decision = await this.deps.authorization.check({
      userId: actor.userId,
      tenantId: actor.tenantId,
      caseId,
      resourceType: 'employment_case',
      action: 'read',
    });
    if (!decision.allowed) {
      throw new AuthorizationError(decision.reason);
    }

    return this.deps.repository.findCaseGraph(actor.tenantId, caseId);
  }
}

export class ListEmploymentCases {
  constructor(private readonly deps: GetEmploymentCaseDeps) {}

  async execute(actor: Actor): Promise<EmploymentCaseGraph[]> {
    const decision = await this.deps.authorization.check({
      userId: actor.userId,
      tenantId: actor.tenantId,
      resourceType: 'employment_case',
      action: 'read',
    });
    if (!decision.allowed) {
      throw new AuthorizationError(decision.reason);
    }

    return this.deps.repository.listCaseGraphs(actor.tenantId);
  }
}

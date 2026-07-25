import type { OrganizationType } from '@caredesk/domain';
import type { AuditService } from '../ports/audit-service.js';
import type { AuthorizationService } from '../ports/authorization-service.js';
import type { CaseContactRepository, CaseContactRow } from '../ports/case-contact-repository.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { TimelineService } from '../ports/timeline-service.js';
import { AuthorizationError, type Actor } from './open-employment-case.js';

export interface AddContactInput {
  fullName: string;
  title?: string;
  preferredChannel?: string;
  organizationId?: string;
  organization?: {
    name: string;
    organizationType: OrganizationType;
    phone?: string;
    email?: string;
  };
  roleType: string;
  isPrimary?: boolean;
  isEmergency?: boolean;
}

export interface CaseContactDeps {
  authorization: AuthorizationService;
  repository: CaseContactRepository;
  audit: AuditService;
  timeline: TimelineService;
  clock: Clock;
  ids: IdGenerator;
}

export class AddContactToCase {
  constructor(private readonly deps: CaseContactDeps) {}

  async execute(
    actor: Actor,
    caseId: string,
    input: AddContactInput,
  ): Promise<{ contactId: string }> {
    const decision = await this.deps.authorization.check({
      userId: actor.userId,
      tenantId: actor.tenantId,
      caseId,
      resourceType: 'case_contact',
      action: 'create',
    });
    if (!decision.allowed) {
      throw new AuthorizationError(decision.reason);
    }

    const contactId = this.deps.ids.next();
    const roleId = this.deps.ids.next();
    const now = this.deps.clock.now().toISOString();

    await this.deps.repository.addContactToCase({
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      contactId,
      roleId,
      fullName: input.fullName,
      title: input.title ?? null,
      preferredChannel: input.preferredChannel ?? null,
      roleType: input.roleType,
      isPrimary: input.isPrimary ?? false,
      isEmergency: input.isEmergency ?? false,
      organizationId: input.organizationId ?? null,
      newOrganization: input.organization
        ? {
            id: this.deps.ids.next(),
            name: input.organization.name,
            organizationType: input.organization.organizationType,
            phone: input.organization.phone ?? null,
            email: input.organization.email ?? null,
          }
        : null,
    });

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'case_contact.added',
      resourceType: 'case_contact_role',
      resourceId: roleId,
      correlationId: actor.correlationId,
      occurredAt: now,
      // Role, not name: audit records what happened, not who it is about
      // (Constitution §19 — no unnecessary personal content in audit).
      changeSummary: `Contact added to case with role "${input.roleType}".`,
      sensitivity: 'employment_sensitive',
    });

    await this.deps.timeline.record({
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      eventTypeKey: 'timeline.contact.added',
      occurredAt: now,
      summaryKey: 'timeline.contact.added.summary',
      sensitivity: 'general',
    });

    return { contactId };
  }
}

export class ListCaseContacts {
  constructor(private readonly deps: Pick<CaseContactDeps, 'authorization' | 'repository'>) {}

  async execute(actor: Actor, caseId: string): Promise<CaseContactRow[]> {
    const decision = await this.deps.authorization.check({
      userId: actor.userId,
      tenantId: actor.tenantId,
      caseId,
      resourceType: 'case_contact',
      action: 'read',
    });
    if (!decision.allowed) {
      throw new AuthorizationError(decision.reason);
    }
    return this.deps.repository.listCaseContacts(actor.tenantId, caseId);
  }
}

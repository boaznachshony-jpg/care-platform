import type { Caregiver } from '@caredesk/domain';
import type { AuditService } from '../ports/audit-service.js';
import type { AuthorizationService } from '../ports/authorization-service.js';
import type {
  CaseFoundationRepository,
  UpdateCaregiverProfile,
} from '../ports/case-foundation-repository.js';
import type { Clock } from '../ports/clock.js';
import type { Actor } from './actor.js';
import { authorizeOrThrow } from './authorize.js';

export interface UpdateCaregiverDeps {
  authorization: AuthorizationService;
  repository: CaseFoundationRepository;
  audit: AuditService;
  clock: Clock;
}

/**
 * The caregiver identity fields covered here (legal name, preferred name,
 * nationality, primary language) already have a canonical home — the
 * `caregiver` table, created atomically with every case (migration 0003,
 * OpenEmploymentCase). Before this use case existed there was no way to
 * change them again after intake, so a name correction or a language update
 * had nowhere to go but the browser-only profile
 * (`caredesk.mvp.profile.v1`'s `caregiverName`/`caregiverCountry`/
 * `caregiverLanguage`) even though the canonical table was sitting right
 * there. See ports/case-foundation-repository.ts for why the passport number
 * field is deliberately not part of this.
 */
export class UpdateCaregiverProfileUseCase {
  constructor(private readonly deps: UpdateCaregiverDeps) {}

  /** Returns null when the caregiver does not exist or belongs to another tenant. */
  async execute(
    actor: Actor,
    caseId: string,
    caregiverId: string,
    changes: UpdateCaregiverProfile,
  ): Promise<Caregiver | null> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'caregiver',
      action: 'update',
      caseId,
      resourceId: caregiverId,
      sensitivity: 'employment_sensitive',
    });

    const now = this.deps.clock.now().toISOString();
    const caregiver = await this.deps.repository.updateCaregiver(
      actor.tenantId,
      caregiverId,
      changes,
    );
    if (!caregiver) return null;

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'caregiver.updated',
      resourceType: 'caregiver',
      resourceId: caregiver.id,
      correlationId: actor.correlationId,
      occurredAt: now,
      // Field names only — a legal name is identity-sensitive and never
      // belongs in an audit change summary.
      changeSummary: `Caregiver fields updated: ${Object.keys(changes).join(', ') || 'none'}.`,
      sensitivity: 'identity_sensitive',
    });

    return caregiver;
  }
}

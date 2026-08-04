import type { AuditService } from '../ports/audit-service.js';
import type { AuthorizationService } from '../ports/authorization-service.js';
import type { Clock } from '../ports/clock.js';
import type { WorkspaceRecord, WorkspaceRepository } from '../ports/workspace-repository.js';
import type { Actor } from './actor.js';
import { authorizeOrThrow } from './authorize.js';

interface WorkspaceDeps {
  authorization: AuthorizationService;
  workspaces: WorkspaceRepository;
  audit: AuditService;
  clock: Clock;
}

export class GetWorkspace {
  constructor(private readonly deps: WorkspaceDeps) {}

  async execute(actor: Actor): Promise<WorkspaceRecord | null> {
    await authorizeOrThrow(this.deps, actor, { resourceType: 'workspace', action: 'read' });
    return this.deps.workspaces.find(actor.tenantId);
  }
}

export class SaveWorkspace {
  constructor(private readonly deps: WorkspaceDeps) {}

  async execute(
    actor: Actor,
    input: { schemaVersion: number; payload: Record<string, string>; expectedVersion: number },
  ): Promise<WorkspaceRecord | null> {
    await authorizeOrThrow(this.deps, actor, { resourceType: 'workspace', action: 'update' });
    const now = this.deps.clock.now();
    const saved = await this.deps.workspaces.save({
      tenantId: actor.tenantId,
      schemaVersion: input.schemaVersion,
      payload: input.payload,
      expectedVersion: input.expectedVersion,
      updatedBy: actor.userId,
      updatedAt: now.toISOString(),
    });
    if (!saved) return null;

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'workspace.saved',
      resourceType: 'workspace',
      resourceId: actor.tenantId,
      correlationId: actor.correlationId,
      occurredAt: now.toISOString(),
      changeSummary: `Workspace schema ${input.schemaVersion} saved as version ${saved.version}.`,
      sensitivity: 'general',
    });
    return saved;
  }
}

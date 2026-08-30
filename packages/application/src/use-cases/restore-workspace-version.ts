import { populatedEntryCount } from '../ports/workspace-repository.js';
import type { AuditService } from '../ports/audit-service.js';
import type { AuthorizationService } from '../ports/authorization-service.js';
import type { Clock } from '../ports/clock.js';
import type {
  WorkspaceHistoryRepository,
  WorkspaceVersionSummary,
} from '../ports/workspace-history-repository.js';
import type { WorkspaceRecord, WorkspaceRepository } from '../ports/workspace-repository.js';
import type { Actor } from './actor.js';
import { authorizeOrThrow } from './authorize.js';

/**
 * Per-tenant restore.
 *
 * Before this, recovering one tenant meant: restore the whole project to a
 * disposable Supabase instance from a daily backup, inside a seven-day window,
 * gated on one person's owner credential; query the copy; decrypt the payload
 * by hand; diff it by eye; and hand-write the missing keys back into
 * production. Every one of those steps is a place to make it worse, and none of
 * them had ever been rehearsed.
 *
 * WHY THIS IS SAFE TO EXPOSE TO THE CUSTOMER'S OWNER RATHER THAN TO AN OPERATOR
 * A restore here is not destructive. It writes through the ordinary save path,
 * which means the BEFORE UPDATE trigger from 0035 archives the live version
 * first: restoring version 12 over version 20 leaves 20 in the archive, so the
 * restore itself is undoable by the same operation. The worst a confused owner
 * can do is move their own workspace between two versions that both still
 * exist. Weighed against the alternative - a recovery path that only works when
 * one specific human is reachable and awake - that is the safer failure.
 *
 * It still asks for MFA at the route, still goes through the same deny-by-
 * default authorization as everything else under its own `workspace:restore`
 * permission (so it can be withheld from `manager` without withholding saving),
 * and still requires the caller to name the version twice.
 */
export class WorkspaceVersionNotFoundError extends Error {
  readonly code = 'WORKSPACE_VERSION_NOT_FOUND';
  constructor(readonly version: number) {
    super(`No archived workspace version ${version} for this tenant.`);
  }
}

/**
 * The confirmation is not ceremony. A restore is the one write in the product
 * that intentionally replaces current data with older data, so the request has
 * to say which version twice - once as the target and once as the confirmation.
 * A client that builds the request from a stale list cannot satisfy both.
 */
export class WorkspaceRestoreNotConfirmedError extends Error {
  readonly code = 'WORKSPACE_RESTORE_NOT_CONFIRMED';
  constructor() {
    super('The restore request did not confirm the version it names.');
  }
}

interface RestoreDeps {
  authorization: AuthorizationService;
  workspaces: WorkspaceRepository;
  history: WorkspaceHistoryRepository;
  audit: AuditService;
  clock: Clock;
}

/** A list longer than this is a paging problem, not a recovery problem. */
export const MAX_WORKSPACE_VERSIONS_LISTED = 50;

export class ListWorkspaceVersions {
  constructor(private readonly deps: RestoreDeps) {}

  async execute(actor: Actor): Promise<WorkspaceVersionSummary[]> {
    await authorizeOrThrow(this.deps, actor, { resourceType: 'workspace', action: 'restore' });
    const versions = await this.deps.history.listVersions(
      actor.tenantId,
      MAX_WORKSPACE_VERSIONS_LISTED,
    );
    // Audited as a read of recovery metadata rather than of the workspace:
    // somebody looking at the version list is usually somebody who thinks data
    // is missing, and that is worth being able to see afterwards.
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'workspace.versions.listed',
      resourceType: 'workspace',
      resourceId: actor.tenantId,
      correlationId: actor.correlationId,
      occurredAt: this.deps.clock.now().toISOString(),
      changeSummary: `${versions.length} archived workspace version(s) listed.`,
      sensitivity: 'general',
    });
    return versions;
  }
}

export class RestoreWorkspaceVersion {
  constructor(private readonly deps: RestoreDeps) {}

  async execute(
    actor: Actor,
    input: { version: number; confirmVersion: number },
  ): Promise<WorkspaceRecord | null> {
    await authorizeOrThrow(this.deps, actor, { resourceType: 'workspace', action: 'restore' });
    if (input.version !== input.confirmVersion) throw new WorkspaceRestoreNotConfirmedError();

    const archived = await this.deps.history.findVersion(actor.tenantId, input.version);
    if (!archived) throw new WorkspaceVersionNotFoundError(input.version);

    const live = await this.deps.workspaces.find(actor.tenantId);
    const now = this.deps.clock.now();
    const saved = await this.deps.workspaces.save({
      tenantId: actor.tenantId,
      schemaVersion: archived.schemaVersion,
      payload: archived.payload,
      expectedVersion: live?.version ?? 0,
      updatedBy: actor.userId,
      updatedAt: now.toISOString(),
      // A restore is the one save that is allowed to shrink. The guard exists
      // to stop a client publishing a snapshot it could not read; here the
      // smaller payload is the deliberate, named, confirmed goal. The live
      // version is archived by the 0035 trigger on the way past, so the shrink
      // this permits is reversible by repeating this same operation.
      allowShrink: true,
    });
    // Null means optimistic concurrency lost: somebody saved between the read
    // and the write. Reported as a conflict rather than retried, because a
    // restore that silently races a live save is exactly the "merge writes an
    // inconsistent state" failure this replaces.
    if (!saved) return null;

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'workspace.version.restored',
      resourceType: 'workspace',
      resourceId: actor.tenantId,
      correlationId: actor.correlationId,
      occurredAt: now.toISOString(),
      // Counts, not content: enough for an incident review to say what moved.
      changeSummary:
        `Restored archived version ${input.version} over live version ${live?.version ?? 0} ` +
        `as version ${saved.version}; populated entries ${populatedEntryCount(live?.payload ?? {})} -> ` +
        `${populatedEntryCount(saved.payload)}.`,
      sensitivity: 'general',
    });
    return saved;
  }
}

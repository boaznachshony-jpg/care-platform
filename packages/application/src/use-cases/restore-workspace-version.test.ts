import { describe, expect, it } from 'vitest';
import type { AuditEventInput, AuditService } from '../ports/audit-service.js';
import type {
  AuthorizationContext,
  AuthorizationDecision,
  AuthorizationService,
} from '../ports/authorization-service.js';
import type {
  ArchivedWorkspaceVersion,
  WorkspaceHistoryRepository,
  WorkspaceVersionSummary,
} from '../ports/workspace-history-repository.js';
import type {
  SaveWorkspaceRecord,
  WorkspaceRecord,
  WorkspaceRepository,
} from '../ports/workspace-repository.js';
import { isDestructiveShrink } from '../ports/workspace-repository.js';
import { AuthorizationError, type Actor } from './actor.js';
import {
  ListWorkspaceVersions,
  RestoreWorkspaceVersion,
  WorkspaceRestoreNotConfirmedError,
  WorkspaceVersionNotFoundError,
} from './restore-workspace-version.js';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';

const actor: Actor = {
  userId: USER_ID,
  tenantId: TENANT_ID,
  correlationId: 'correlation-1',
  mfaSatisfied: true,
};

const populated = (count: number): Record<string, string> =>
  Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`caredesk.mvp.key.${index}`, `value ${index}`]),
  );

class AllowedAuthorization implements AuthorizationService {
  readonly asked: AuthorizationContext[] = [];
  async check(context: AuthorizationContext): Promise<AuthorizationDecision> {
    this.asked.push(context);
    return { allowed: true, reason: 'test' };
  }
}

class RecordingAudit implements AuditService {
  readonly events: AuditEventInput[] = [];
  async record(event: AuditEventInput) {
    this.events.push(event);
  }
}

class FakeHistory implements WorkspaceHistoryRepository {
  constructor(private readonly versions: ArchivedWorkspaceVersion[]) {}
  async listVersions(_tenantId: string, limit: number): Promise<WorkspaceVersionSummary[]> {
    return this.versions.slice(0, limit).map((version) => ({
      version: version.version,
      schemaVersion: version.schemaVersion,
      updatedAt: '2026-08-29T10:00:00.000Z',
      archivedAt: '2026-08-29T11:00:00.000Z',
      populatedEntries: Object.keys(version.payload).length,
      payloadBytes: Buffer.byteLength(JSON.stringify(version.payload), 'utf8'),
    }));
  }
  async findVersion(_tenantId: string, version: number) {
    return this.versions.find((candidate) => candidate.version === version) ?? null;
  }
}

/**
 * Mirrors PgWorkspaceRepository on the one property this use case depends on:
 * the shrink guard is real and only `allowShrink` gets past it.
 */
class GuardedWorkspaces implements WorkspaceRepository {
  readonly saves: SaveWorkspaceRecord[] = [];
  constructor(private current: WorkspaceRecord | null) {}
  async find() {
    return this.current;
  }
  async save(input: SaveWorkspaceRecord) {
    this.saves.push(input);
    if ((this.current?.version ?? 0) !== input.expectedVersion) return null;
    if (
      this.current &&
      !input.allowShrink &&
      isDestructiveShrink(this.current.payload, input.payload)
    ) {
      throw new Error('shrink guard would have refused this restore');
    }
    this.current = {
      tenantId: input.tenantId,
      schemaVersion: input.schemaVersion,
      payload: input.payload,
      version: input.expectedVersion + 1,
      updatedAt: input.updatedAt,
    };
    return this.current;
  }
}

function build(options: {
  live: WorkspaceRecord | null;
  archived: ArchivedWorkspaceVersion[];
  authorization?: AuthorizationService;
}) {
  const authorization = options.authorization ?? new AllowedAuthorization();
  const audit = new RecordingAudit();
  const workspaces = new GuardedWorkspaces(options.live);
  const deps = {
    authorization,
    workspaces,
    history: new FakeHistory(options.archived),
    audit,
    clock: { now: () => new Date('2026-08-30T12:00:00.000Z') },
  };
  return {
    audit,
    workspaces,
    authorization,
    restore: new RestoreWorkspaceVersion(deps),
    list: new ListWorkspaceVersions(deps),
  };
}

const liveWorkspace = (version: number, entries: number): WorkspaceRecord => ({
  tenantId: TENANT_ID,
  schemaVersion: 1,
  payload: populated(entries),
  version,
  updatedAt: '2026-08-30T09:00:00.000Z',
});

describe('RestoreWorkspaceVersion', () => {
  it('restores an archived version over a blanked live workspace', async () => {
    // The 2026-08-29 incident, undone: version 12 held 29 entries, version 13
    // held blanks. Before this use case existed, getting 12 back meant a
    // full-project restore to a disposable Supabase instance and a hand merge.
    const archived = { version: 12, schemaVersion: 1, payload: populated(29) };
    const blanked: WorkspaceRecord = {
      tenantId: TENANT_ID,
      schemaVersion: 1,
      payload: Object.fromEntries(Object.keys(populated(29)).map((key) => [key, ''])),
      version: 13,
      updatedAt: '2026-08-30T09:00:00.000Z',
    };
    const { restore, workspaces } = build({ live: blanked, archived: [archived] });

    const result = await restore.execute(actor, { version: 12, confirmVersion: 12 });

    expect(result).toMatchObject({ version: 14 });
    expect(result?.payload).toEqual(populated(29));
    // Written through the ordinary save path, so the 0035 BEFORE UPDATE trigger
    // archives version 13 on the way past and the restore is itself undoable.
    expect(workspaces.saves[0]).toMatchObject({ expectedVersion: 13 });
  });

  it('sets allowShrink, because restoring an older version is a deliberate shrink', async () => {
    // Without this the write-time guard refuses the recovery: the payload
    // really is much smaller than what is live, which is the whole point.
    const { restore, workspaces } = build({
      live: liveWorkspace(20, 30),
      archived: [{ version: 5, schemaVersion: 1, payload: populated(4) }],
    });

    await expect(restore.execute(actor, { version: 5, confirmVersion: 5 })).resolves.toMatchObject({
      version: 21,
    });
    expect(workspaces.saves[0]?.allowShrink).toBe(true);
  });

  it('refuses when the request does not confirm the version it names', async () => {
    const { restore, workspaces } = build({
      live: liveWorkspace(20, 30),
      archived: [{ version: 5, schemaVersion: 1, payload: populated(4) }],
    });

    await expect(restore.execute(actor, { version: 5, confirmVersion: 6 })).rejects.toBeInstanceOf(
      WorkspaceRestoreNotConfirmedError,
    );
    expect(workspaces.saves).toEqual([]);
  });

  it('refuses a version that was never archived, without writing anything', async () => {
    const { restore, workspaces } = build({ live: liveWorkspace(20, 30), archived: [] });

    await expect(restore.execute(actor, { version: 5, confirmVersion: 5 })).rejects.toBeInstanceOf(
      WorkspaceVersionNotFoundError,
    );
    expect(workspaces.saves).toEqual([]);
  });

  it('asks for workspace:restore, not workspace:update', async () => {
    // A separate permission is what lets the owner hold recovery while a
    // manager keeps ordinary saving.
    const authorization = new AllowedAuthorization();
    const { restore } = build({
      live: liveWorkspace(20, 30),
      archived: [{ version: 5, schemaVersion: 1, payload: populated(4) }],
      authorization,
    });

    await restore.execute(actor, { version: 5, confirmVersion: 5 });

    expect(authorization.asked[0]).toMatchObject({
      resourceType: 'workspace',
      action: 'restore',
    });
  });

  it('refuses when authorization denies, and writes no workspace', async () => {
    const denying: AuthorizationService = {
      async check() {
        return { allowed: false, reason: 'Role "viewer" lacks "workspace:restore".' };
      },
    };
    const { restore, workspaces } = build({
      live: liveWorkspace(20, 30),
      archived: [{ version: 5, schemaVersion: 1, payload: populated(4) }],
      authorization: denying,
    });

    await expect(restore.execute(actor, { version: 5, confirmVersion: 5 })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(workspaces.saves).toEqual([]);
  });

  it('audits the restore with counts and no payload', async () => {
    const { restore, audit } = build({
      live: liveWorkspace(20, 30),
      archived: [{ version: 5, schemaVersion: 1, payload: populated(4) }],
    });

    await restore.execute(actor, { version: 5, confirmVersion: 5 });

    const event = audit.events.at(-1);
    expect(event).toMatchObject({
      action: 'workspace.version.restored',
      tenantId: TENANT_ID,
      actorId: USER_ID,
    });
    expect(event?.changeSummary).toContain('30 -> 4');
    expect(event?.changeSummary).not.toContain('value 0');
  });

  it('reports a lost optimistic-concurrency race as null rather than forcing the write', async () => {
    const { restore } = build({
      live: liveWorkspace(20, 30),
      archived: [{ version: 5, schemaVersion: 1, payload: populated(4) }],
    });
    // A save landing between the read and the write moves the live version on.
    const raced = new RestoreWorkspaceVersion({
      authorization: new AllowedAuthorization(),
      workspaces: {
        async find() {
          return liveWorkspace(20, 30);
        },
        async save() {
          return null;
        },
      },
      history: new FakeHistory([{ version: 5, schemaVersion: 1, payload: populated(4) }]),
      audit: new RecordingAudit(),
      clock: { now: () => new Date('2026-08-30T12:00:00.000Z') },
    });

    await expect(raced.execute(actor, { version: 5, confirmVersion: 5 })).resolves.toBeNull();
    expect(restore).toBeDefined();
  });
});

describe('ListWorkspaceVersions', () => {
  it('returns metadata and never the payload', async () => {
    const { list } = build({
      live: liveWorkspace(20, 30),
      archived: [{ version: 5, schemaVersion: 1, payload: populated(4) }],
    });

    const versions = await list.execute(actor);

    expect(versions).toHaveLength(1);
    expect(JSON.stringify(versions)).not.toContain('value 0');
    expect(versions[0]).toMatchObject({ version: 5, populatedEntries: 4 });
  });

  it('audits that somebody went looking for older versions', async () => {
    const { list, audit } = build({ live: liveWorkspace(20, 30), archived: [] });

    await list.execute(actor);

    expect(audit.events.at(-1)).toMatchObject({ action: 'workspace.versions.listed' });
  });
});

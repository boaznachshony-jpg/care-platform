import type { AuditService } from '../ports/audit-service.js';
import type { AuthorizationService } from '../ports/authorization-service.js';
import type { Clock } from '../ports/clock.js';
import type { DocumentStorage } from '../ports/document-storage.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type {
  WorkspaceFileRecord,
  WorkspaceFileRepository,
} from '../ports/workspace-file-repository.js';
import type { Actor } from './actor.js';
import { authorizeOrThrow } from './authorize.js';
import { decodeBase64, DOWNLOAD_URL_TTL_SECONDS } from './manage-case-documents.js';

interface WorkspaceFileDeps {
  authorization: AuthorizationService;
  files: WorkspaceFileRepository;
  storage: DocumentStorage;
  audit: AuditService;
  clock: Clock;
  ids: IdGenerator;
}

export class PutWorkspaceFile {
  constructor(private readonly deps: WorkspaceFileDeps) {}

  async execute(
    actor: Actor,
    clientId: string,
    documentId: string,
    input: { mediaType: string; content: string },
  ): Promise<WorkspaceFileRecord> {
    await authorizeOrThrow(this.deps, actor, { resourceType: 'workspace', action: 'update' });
    const bytes = decodeBase64(input.content);
    const objectId = this.deps.ids.next();
    const { storageKey } = await this.deps.storage.putObject({
      tenantId: actor.tenantId,
      key: `workspaces/${clientId}/documents/${documentId}/${objectId}`,
      contentType: input.mediaType,
      body: bytes,
    });
    const previous = await this.deps.files.find(actor.tenantId, clientId, documentId);
    const now = this.deps.clock.now();
    const saved = await this.deps.files.upsert({
      tenantId: actor.tenantId,
      clientId,
      documentId,
      storageKey,
      mediaType: input.mediaType,
      sizeBytes: bytes.byteLength,
      updatedBy: actor.userId,
      updatedAt: now.toISOString(),
    });
    if (previous && previous.storageKey !== storageKey) {
      await this.deps.storage.deleteObject(previous.storageKey);
    }
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'workspace.document.uploaded',
      resourceType: 'document',
      resourceId: documentId,
      correlationId: actor.correlationId,
      occurredAt: now.toISOString(),
      changeSummary: `Workspace document version ${saved.version} uploaded.`,
      sensitivity: 'identity_sensitive',
    });
    return saved;
  }
}

export class GetWorkspaceFileUrl {
  constructor(private readonly deps: WorkspaceFileDeps) {}

  async execute(actor: Actor, clientId: string, documentId: string): Promise<string | null> {
    await authorizeOrThrow(this.deps, actor, { resourceType: 'workspace', action: 'read' });
    const file = await this.deps.files.find(actor.tenantId, clientId, documentId);
    if (!file) return null;
    const url = await this.deps.storage.getSignedUrl(file.storageKey, DOWNLOAD_URL_TTL_SECONDS);
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'workspace.document.downloaded',
      resourceType: 'document',
      resourceId: documentId,
      correlationId: actor.correlationId,
      occurredAt: this.deps.clock.now().toISOString(),
      changeSummary: 'Short-lived workspace document link issued.',
      sensitivity: 'identity_sensitive',
    });
    return url;
  }
}

export class DeleteWorkspaceFile {
  constructor(private readonly deps: WorkspaceFileDeps) {}

  async execute(actor: Actor, clientId: string, documentId: string): Promise<boolean> {
    await authorizeOrThrow(this.deps, actor, { resourceType: 'workspace', action: 'update' });
    const removed = await this.deps.files.delete(actor.tenantId, clientId, documentId);
    if (!removed) return false;
    await this.deps.storage.deleteObject(removed.storageKey);
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'workspace.document.deleted',
      resourceType: 'document',
      resourceId: documentId,
      correlationId: actor.correlationId,
      occurredAt: this.deps.clock.now().toISOString(),
      changeSummary: 'Workspace document deleted.',
      sensitivity: 'identity_sensitive',
    });
    return true;
  }
}

import type {
  AttachDocumentVersionRecord,
  CreateDocumentRecord,
  CreateDocumentVersionRecord,
  DocumentRepository,
  DocumentWithCurrentVersion,
} from '@caredesk/application';
import { brandId, type Document, type DocumentVersion } from '@caredesk/domain';

/**
 * Mirrors PgDocumentRepository's contract without a database. Rows are held
 * per tenant so a lookup can never cross a tenant boundary here either — the
 * mock must not be more permissive than RLS.
 */
export class InMemoryDocumentRepository implements DocumentRepository {
  private readonly byTenant = new Map<string, DocumentWithCurrentVersion[]>();

  async createDocumentWithVersion(
    input: CreateDocumentVersionRecord,
  ): Promise<DocumentWithCurrentVersion> {
    const document: Document = {
      id: brandId(input.documentId),
      tenantId: brandId(input.tenantId),
      employmentCaseId: brandId(input.employmentCaseId),
      documentType: input.documentType,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      sensitivity: input.sensitivity,
      complianceStatus: input.complianceStatus,
      currentVersionId: brandId(input.versionId),
      expiresAt: input.expiresAt,
      status: 'active',
      legacyLocalId: input.legacyLocalId ?? null,
    };

    const currentVersion: DocumentVersion = {
      id: brandId(input.versionId),
      tenantId: brandId(input.tenantId),
      documentId: brandId(input.documentId),
      versionNumber: 1,
      storageKey: input.storageKey,
      mediaType: input.mediaType,
      sizeBytes: input.sizeBytes,
      checksum: input.checksum,
      uploadSource: 'web_upload',
      verificationStatus: 'uploaded',
      verifiedBy: null,
      verifiedAt: null,
      supersedesVersionId: null,
      createdAt: new Date(0).toISOString(),
    };

    const entry: DocumentWithCurrentVersion = { document, currentVersion };
    const rows = this.byTenant.get(input.tenantId) ?? [];
    rows.push(entry);
    this.byTenant.set(input.tenantId, rows);
    return entry;
  }

  async createDocument(input: CreateDocumentRecord): Promise<DocumentWithCurrentVersion> {
    const document: Document = {
      id: brandId(input.documentId),
      tenantId: brandId(input.tenantId),
      employmentCaseId: brandId(input.employmentCaseId),
      documentType: input.documentType,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      sensitivity: input.sensitivity,
      complianceStatus: input.complianceStatus,
      currentVersionId: null,
      expiresAt: input.expiresAt,
      status: 'active',
      legacyLocalId: input.legacyLocalId ?? null,
    };
    const entry: DocumentWithCurrentVersion = { document, currentVersion: null };
    const rows = this.byTenant.get(input.tenantId) ?? [];
    rows.push(entry);
    this.byTenant.set(input.tenantId, rows);
    return entry;
  }

  /**
   * Mirrors PgDocumentRepository.attachDocumentVersion: no version to attach
   * onto, or one already exists (another call won a simulated race), returns
   * null either way — same "nothing to do" contract the caller relies on.
   * There is no real concurrency in this in-memory store (everything runs
   * synchronously between `await` points), so the null branch here is only
   * exercised by an explicit "already has a version" test, not a genuine
   * race — the real race protection is PgDocumentRepository's row lock.
   */
  async attachDocumentVersion(
    input: AttachDocumentVersionRecord,
  ): Promise<DocumentWithCurrentVersion | null> {
    const rows = this.byTenant.get(input.tenantId) ?? [];
    const index = rows.findIndex(
      (entry) =>
        entry.document.id === input.documentId &&
        entry.document.employmentCaseId === input.employmentCaseId,
    );
    const entry = index === -1 ? undefined : rows[index];
    if (!entry || entry.document.currentVersionId !== null) {
      return null;
    }

    const currentVersion: DocumentVersion = {
      id: brandId(input.versionId),
      tenantId: brandId(input.tenantId),
      documentId: brandId(input.documentId),
      versionNumber: 1,
      storageKey: input.storageKey,
      mediaType: input.mediaType,
      sizeBytes: input.sizeBytes,
      checksum: input.checksum,
      uploadSource: 'web_upload',
      verificationStatus: 'uploaded',
      verifiedBy: null,
      verifiedAt: null,
      supersedesVersionId: null,
      createdAt: new Date(0).toISOString(),
    };

    const updated: DocumentWithCurrentVersion = {
      // compliance_status and expires_at are deliberately left untouched —
      // see ImportCaseDocument's comment on why.
      document: { ...entry.document, currentVersionId: brandId(input.versionId) },
      currentVersion,
    };
    rows[index] = updated;
    return updated;
  }

  async findDocumentByLegacyLocalId(
    tenantId: string,
    employmentCaseId: string,
    legacyLocalId: string,
  ): Promise<DocumentWithCurrentVersion | null> {
    return (
      (this.byTenant.get(tenantId) ?? []).find(
        (entry) =>
          entry.document.employmentCaseId === employmentCaseId &&
          entry.document.legacyLocalId === legacyLocalId,
      ) ?? null
    );
  }

  async listCaseDocuments(
    tenantId: string,
    employmentCaseId: string,
  ): Promise<DocumentWithCurrentVersion[]> {
    return (this.byTenant.get(tenantId) ?? []).filter(
      (entry) =>
        entry.document.employmentCaseId === employmentCaseId && entry.document.status === 'active',
    );
  }

  async findCaseDocument(
    tenantId: string,
    employmentCaseId: string,
    documentId: string,
  ): Promise<DocumentWithCurrentVersion | null> {
    return (
      (this.byTenant.get(tenantId) ?? []).find(
        (entry) =>
          entry.document.id === documentId && entry.document.employmentCaseId === employmentCaseId,
      ) ?? null
    );
  }
}

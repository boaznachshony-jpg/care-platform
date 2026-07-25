import type {
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

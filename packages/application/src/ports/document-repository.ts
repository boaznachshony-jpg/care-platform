import type { Document, DocumentVersion } from '@caredesk/domain';

/**
 * What the repository needs to persist a document and its first/next file
 * version, distinct from the use case's caller-facing input (which carries an
 * expiry *date* and no ids).
 *
 * `storageKey` is a private object-storage key. It never leaves this layer:
 * it is not in any response schema and must never be logged (Constitution §16).
 */
export interface CreateDocumentVersionRecord {
  documentId: string;
  versionId: string;
  tenantId: string;
  employmentCaseId: string;
  documentType: Document['documentType'];
  ownerType: Document['ownerType'];
  ownerId: string | null;
  sensitivity: Document['sensitivity'];
  complianceStatus: Document['complianceStatus'];
  expiresAt: string | null;
  storageKey: string;
  mediaType: string;
  sizeBytes: number;
  checksum: string | null;
  createdBy: string;
}

/** A document with the fields of its current version folded in, for list views. */
export interface DocumentWithCurrentVersion {
  document: Document;
  currentVersion: DocumentVersion | null;
}

export interface DocumentRepository {
  /**
   * Creates the document container and its first version atomically, then
   * points `current_version_id` at that version.
   */
  createDocumentWithVersion(
    input: CreateDocumentVersionRecord,
  ): Promise<DocumentWithCurrentVersion>;
  listCaseDocuments(
    tenantId: string,
    employmentCaseId: string,
  ): Promise<DocumentWithCurrentVersion[]>;
  /** Returns null when the document does not exist, is in another tenant, or is on another case. */
  findCaseDocument(
    tenantId: string,
    employmentCaseId: string,
    documentId: string,
  ): Promise<DocumentWithCurrentVersion | null>;
}

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
  /** Set only by ImportCaseDocument — see Document.legacyLocalId. */
  legacyLocalId?: string | null;
}

/**
 * A document container with no file yet — the metadata-only import path for a
 * browser record that has no scanned file attached (`MvpDocument.dataUrl` was
 * never set). `document.current_version_id` stays null, exactly as it does for
 * any document nobody has uploaded a file to yet; the family can attach the
 * scan later through the normal upload flow, which adds the first version.
 */
export interface CreateDocumentRecord {
  documentId: string;
  tenantId: string;
  employmentCaseId: string;
  documentType: Document['documentType'];
  ownerType: Document['ownerType'];
  ownerId: string | null;
  sensitivity: Document['sensitivity'];
  complianceStatus: Document['complianceStatus'];
  expiresAt: string | null;
  createdBy: string;
  legacyLocalId?: string | null;
}

/** A document with the fields of its current version folded in, for list views. */
export interface DocumentWithCurrentVersion {
  document: Document;
  currentVersion: DocumentVersion | null;
}

/**
 * What the repository needs to attach a FIRST file version onto a document
 * container that already exists but has none — the "metadata was imported
 * before the scan was" gap ImportCaseDocument closes. Deliberately narrower
 * than CreateDocumentVersionRecord: it carries no documentType, sensitivity,
 * complianceStatus or expiresAt, because attaching a file never rewrites any
 * of those — they were already set by whichever import/upload created the
 * container (see ImportCaseDocument.execute's comment on why).
 */
export interface AttachDocumentVersionRecord {
  documentId: string;
  versionId: string;
  tenantId: string;
  employmentCaseId: string;
  storageKey: string;
  mediaType: string;
  sizeBytes: number;
  checksum: string | null;
  createdBy: string;
}

export interface DocumentRepository {
  /**
   * Creates the document container and its first version atomically, then
   * points `current_version_id` at that version.
   */
  createDocumentWithVersion(
    input: CreateDocumentVersionRecord,
  ): Promise<DocumentWithCurrentVersion>;
  /** Creates the container only, with no version — see CreateDocumentRecord. */
  createDocument(input: CreateDocumentRecord): Promise<DocumentWithCurrentVersion>;
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
  /**
   * The document previously imported from this local id, or null. Read before
   * any import write — see TaskRepository.findTaskByLegacyLocalId for why.
   */
  findDocumentByLegacyLocalId(
    tenantId: string,
    employmentCaseId: string,
    legacyLocalId: string,
  ): Promise<DocumentWithCurrentVersion | null>;
  /**
   * Attaches a file as a document's first version. Only valid when the
   * document has no current version yet — see AttachDocumentVersionRecord.
   *
   * Returns null, not an error, when by the time this runs the document
   * already has a current version (another concurrent call already attached
   * one, or it never had a gap to begin with). This is the idempotency guard
   * for two racing imports of the same legacy record: the caller treats null
   * exactly like "nothing to do", the same way it already treats a repeat
   * import found via findDocumentByLegacyLocalId. Implementations MUST make
   * the check-then-attach atomic (e.g. a row lock or a conditional update
   * inside one transaction) — a caller-side check-then-act is not enough
   * because two requests can both pass it before either writes.
   */
  attachDocumentVersion(
    input: AttachDocumentVersionRecord,
  ): Promise<DocumentWithCurrentVersion | null>;
}

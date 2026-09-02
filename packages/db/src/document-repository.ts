import type {
  CreateDocumentRecord,
  CreateDocumentVersionRecord,
  DocumentRepository,
  DocumentWithCurrentVersion,
} from '@caredesk/application';
import { brandId, type Document, type DocumentVersion } from '@caredesk/domain';
import type { Pool } from 'pg';
import { withTenant } from './pool.js';

interface DocumentRow {
  id: string;
  tenant_id: string;
  employment_case_id: string;
  document_type: string;
  owner_type: string;
  owner_id: string | null;
  sensitivity: string;
  compliance_status: string;
  current_version_id: string | null;
  expires_at: Date | null;
  status: string;
  legacy_local_id: string | null;
}

interface VersionRow {
  v_id: string | null;
  v_document_id: string | null;
  v_version_number: number | null;
  v_storage_key: string | null;
  v_media_type: string | null;
  v_size_bytes: string | null;
  v_checksum: string | null;
  v_upload_source: string | null;
  v_verification_status: string | null;
  v_verified_by: string | null;
  v_verified_at: Date | null;
  v_supersedes_version_id: string | null;
  v_created_at: Date | null;
}

type JoinedRow = DocumentRow & VersionRow;

function toDocument(row: DocumentRow): Document {
  return {
    id: brandId(row.id),
    tenantId: brandId(row.tenant_id),
    employmentCaseId: brandId(row.employment_case_id),
    documentType: row.document_type as Document['documentType'],
    ownerType: row.owner_type as Document['ownerType'],
    ownerId: row.owner_id,
    sensitivity: row.sensitivity as Document['sensitivity'],
    complianceStatus: row.compliance_status as Document['complianceStatus'],
    currentVersionId: row.current_version_id ? brandId(row.current_version_id) : null,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    status: row.status as Document['status'],
    legacyLocalId: row.legacy_local_id,
  };
}

function toVersion(row: VersionRow, tenantId: string): DocumentVersion | null {
  if (
    row.v_id === null ||
    row.v_document_id === null ||
    row.v_version_number === null ||
    row.v_storage_key === null ||
    row.v_media_type === null ||
    row.v_created_at === null
  ) {
    return null;
  }
  return {
    id: brandId(row.v_id),
    // Same tenant by construction: the join is tenant-matched and the FK is composite.
    tenantId: brandId(tenantId),
    documentId: brandId(row.v_document_id),
    versionNumber: row.v_version_number,
    storageKey: row.v_storage_key,
    mediaType: row.v_media_type,
    // bigint arrives as a string from node-postgres; a document size fits a
    // JS number many times over, so the narrowing is safe here.
    sizeBytes: Number(row.v_size_bytes ?? 0),
    checksum: row.v_checksum,
    uploadSource: (row.v_upload_source ?? 'web_upload') as DocumentVersion['uploadSource'],
    verificationStatus: (row.v_verification_status ??
      'uploaded') as DocumentVersion['verificationStatus'],
    verifiedBy: row.v_verified_by,
    verifiedAt: row.v_verified_at ? row.v_verified_at.toISOString() : null,
    supersedesVersionId: row.v_supersedes_version_id ? brandId(row.v_supersedes_version_id) : null,
    createdAt: row.v_created_at.toISOString(),
  };
}

function toResult(row: JoinedRow): DocumentWithCurrentVersion {
  const document = toDocument(row);
  return { document, currentVersion: toVersion(row, row.tenant_id) };
}

const DOCUMENT_COLUMNS = `d.id, d.tenant_id, d.employment_case_id, d.document_type,
  d.owner_type, d.owner_id, d.sensitivity, d.compliance_status, d.current_version_id,
  d.expires_at, d.status, d.legacy_local_id`;

// Same fields, unaliased — for `insert ... returning`, which has no `d.` join alias.
const DOCUMENT_COLUMNS_UNALIASED = `id, tenant_id, employment_case_id, document_type,
  owner_type, owner_id, sensitivity, compliance_status, current_version_id,
  expires_at, status, legacy_local_id`;

const VERSION_COLUMNS = `v.id as v_id, v.document_id as v_document_id,
  v.version_number as v_version_number, v.storage_key as v_storage_key,
  v.media_type as v_media_type, v.size_bytes as v_size_bytes, v.checksum as v_checksum,
  v.upload_source as v_upload_source, v.verification_status as v_verification_status,
  v.verified_by as v_verified_by, v.verified_at as v_verified_at,
  v.supersedes_version_id as v_supersedes_version_id, v.created_at as v_created_at`;

const SELECT_JOINED = `select ${DOCUMENT_COLUMNS}, ${VERSION_COLUMNS}
  from document d
  left join document_version v on v.id = d.current_version_id and v.tenant_id = d.tenant_id`;

export class PgDocumentRepository implements DocumentRepository {
  constructor(private readonly pool: Pool) {}

  async createDocumentWithVersion(
    input: CreateDocumentVersionRecord,
  ): Promise<DocumentWithCurrentVersion> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      // Ordered inserts, not a chicken-and-egg problem: the container goes in
      // with a null current_version_id, the version references it, then the
      // container is pointed at the version. All three share one transaction,
      // so a document can never be left visible without its file.
      await client.query(
        `insert into document
           (id, tenant_id, employment_case_id, document_type, owner_type, owner_id,
            sensitivity, compliance_status, expires_at, created_by, updated_by, legacy_local_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11)`,
        [
          input.documentId,
          input.tenantId,
          input.employmentCaseId,
          input.documentType,
          input.ownerType,
          input.ownerId,
          input.sensitivity,
          input.complianceStatus,
          input.expiresAt,
          input.createdBy,
          input.legacyLocalId ?? null,
        ],
      );

      await client.query(
        `insert into document_version
           (id, tenant_id, document_id, version_number, storage_key, media_type,
            size_bytes, checksum, upload_source, created_by)
         values ($1, $2, $3, 1, $4, $5, $6, $7, 'web_upload', $8)`,
        [
          input.versionId,
          input.tenantId,
          input.documentId,
          input.storageKey,
          input.mediaType,
          input.sizeBytes,
          input.checksum,
          input.createdBy,
        ],
      );

      await client.query(`update document set current_version_id = $2 where id = $1`, [
        input.documentId,
        input.versionId,
      ]);

      const result = await client.query<JoinedRow>(`${SELECT_JOINED} where d.id = $1`, [
        input.documentId,
      ]);
      const row = result.rows[0];
      if (!row) {
        throw new Error('Document insert returned no row.');
      }
      return toResult(row);
    });
  }

  async createDocument(input: CreateDocumentRecord): Promise<DocumentWithCurrentVersion> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const result = await client.query<DocumentRow>(
        `insert into document
           (id, tenant_id, employment_case_id, document_type, owner_type, owner_id,
            sensitivity, compliance_status, expires_at, created_by, updated_by, legacy_local_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11)
         returning ${DOCUMENT_COLUMNS_UNALIASED}`,
        [
          input.documentId,
          input.tenantId,
          input.employmentCaseId,
          input.documentType,
          input.ownerType,
          input.ownerId,
          input.sensitivity,
          input.complianceStatus,
          input.expiresAt,
          input.createdBy,
          input.legacyLocalId ?? null,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error('Document insert returned no row.');
      }
      return { document: toDocument(row), currentVersion: null };
    });
  }

  async findDocumentByLegacyLocalId(
    tenantId: string,
    employmentCaseId: string,
    legacyLocalId: string,
  ): Promise<DocumentWithCurrentVersion | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<JoinedRow>(
        `${SELECT_JOINED} where d.employment_case_id = $1 and d.legacy_local_id = $2`,
        [employmentCaseId, legacyLocalId],
      );
      const row = result.rows[0];
      return row ? toResult(row) : null;
    });
  }

  async listCaseDocuments(
    tenantId: string,
    employmentCaseId: string,
  ): Promise<DocumentWithCurrentVersion[]> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<JoinedRow>(
        `${SELECT_JOINED}
         where d.employment_case_id = $1 and d.status = 'active'
         order by d.expires_at nulls last, d.created_at asc`,
        [employmentCaseId],
      );
      return result.rows.map(toResult);
    });
  }

  async findCaseDocument(
    tenantId: string,
    employmentCaseId: string,
    documentId: string,
  ): Promise<DocumentWithCurrentVersion | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<JoinedRow>(
        `${SELECT_JOINED} where d.id = $1 and d.employment_case_id = $2`,
        [documentId, employmentCaseId],
      );
      const row = result.rows[0];
      return row ? toResult(row) : null;
    });
  }
}

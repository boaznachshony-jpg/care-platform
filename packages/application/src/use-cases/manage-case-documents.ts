import {
  israelDateOf,
  israelEndOfDayExclusive,
  type DocumentComplianceStatus,
  type DocumentType,
  type SensitivityClass,
} from '@caredesk/domain';
import type { AuditService } from '../ports/audit-service.js';
import type { AuthorizationService } from '../ports/authorization-service.js';
import type { Clock } from '../ports/clock.js';
import type {
  DocumentRepository,
  DocumentWithCurrentVersion,
} from '../ports/document-repository.js';
import type { DocumentStorage } from '../ports/document-storage.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { TimelineService } from '../ports/timeline-service.js';
import type { Actor } from './actor.js';
import { authorizeOrThrow } from './authorize.js';

/**
 * Signed links are short-lived by design (blueprint §4.5). 15 minutes is long
 * enough to start a download on a slow mobile connection and short enough that
 * a leaked URL is worthless by the time it is shared.
 */
export const DOWNLOAD_URL_TTL_SECONDS = 900;

export interface UploadDocumentInput {
  documentType: DocumentType;
  sensitivity: SensitivityClass;
  mediaType: string;
  /** Base64-encoded file bytes. Never logged, never audited, never echoed back. */
  content: string;
  /** ISO date (YYYY-MM-DD). */
  expiresOn?: string;
}

export interface CaseDocumentDeps {
  authorization: AuthorizationService;
  documents: DocumentRepository;
  storage: DocumentStorage;
  audit: AuditService;
  timeline: TimelineService;
  clock: Clock;
  ids: IdGenerator;
}

/**
 * Compliance status is derived, never entered: a document with no expiry is
 * simply valid, one already past its expiry is expired, and one inside the
 * 30-day window is expiring. Milestone 2's rule engine takes this over.
 */
const EXPIRING_WINDOW_DAYS = 30;

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Decoded here by hand rather than with `Buffer` or `atob`: this layer is
 * deliberately runtime-agnostic (no Node types, no DOM types), and a decoder
 * is far cheaper than making the whole package Node-only.
 *
 * Throws on malformed input so a bad upload fails loudly instead of silently
 * writing a truncated file to storage.
 */
export function decodeBase64(value: string): Uint8Array {
  let contentEnd = value.length;
  while (contentEnd > 0 && value.charCodeAt(contentEnd - 1) === 61) contentEnd -= 1;
  const clean = value.slice(0, contentEnd);
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bitBuffer = 0;
  let bitCount = 0;
  let offset = 0;

  for (const character of clean) {
    const index = BASE64_ALPHABET.indexOf(character);
    if (index === -1) {
      throw new Error('Document content is not valid base64.');
    }
    bitBuffer = (bitBuffer << 6) | index;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[offset] = (bitBuffer >> bitCount) & 0xff;
      offset += 1;
    }
  }

  return bytes.subarray(0, offset);
}

/**
 * DOM-17. `expiresOn: '2026-09-01'` is stored as `2026-09-01T00:00:00.000Z` and
 * used to be compared with `expiry <= now`. Israel is UTC+2/+3, so that instant
 * is 02:00 or 03:00 on 1 September local time — and a permit whose תוקף עד is
 * that very day read as EXPIRED for essentially the whole of its final valid
 * day. In this product that means an unnecessary escalation, an unnecessary
 * bureau call, and erosion of trust in the alerts that do matter.
 *
 * The semantics are now settled and written down: **a stored date is the last
 * valid day**, not the first invalid one. So the document expires at the start
 * of the FOLLOWING day in Asia/Jerusalem — `israelEndOfDayExclusive`.
 *
 * Existing rows need no migration and are not reinterpreted beyond this: the
 * stored instant is still read as the calendar day it names, which is what
 * `israelDateOf` recovers from it. UTC midnight is safely inside that day in
 * Israel (02:00/03:00), so every row written before this change resolves to the
 * same calendar day it was entered as. The only thing that changes is that the
 * day is now honoured to its end instead of expiring at 03:00.
 */
export function deriveComplianceStatus(
  expiresAt: string | null,
  now: Date,
): DocumentComplianceStatus {
  if (!expiresAt) return 'valid';
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) return 'valid';
  const expiresAfter = israelEndOfDayExclusive(israelDateOf(parsed)).getTime();
  if (now.getTime() >= expiresAfter) return 'expired';
  const windowMs = EXPIRING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return expiresAfter - now.getTime() <= windowMs ? 'expiring' : 'valid';
}

export class UploadCaseDocument {
  constructor(private readonly deps: CaseDocumentDeps) {}

  async execute(
    actor: Actor,
    caseId: string,
    input: UploadDocumentInput,
  ): Promise<DocumentWithCurrentVersion> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'document',
      action: 'create',
      caseId,
      sensitivity: input.sensitivity,
    });

    const now = this.deps.clock.now();
    const documentId = this.deps.ids.next();
    const versionId = this.deps.ids.next();
    const bytes = decodeBase64(input.content);

    // An expiry is a calendar day; stored at day start so no timezone shift
    // can move a permit's expiry to the previous day.
    const expiresAt = input.expiresOn ? `${input.expiresOn}T00:00:00.000Z` : null;

    // The storage key is derived, never client-supplied — a caller must not be
    // able to steer a write at another tenant's or case's object path.
    const { storageKey } = await this.deps.storage.putObject({
      tenantId: actor.tenantId,
      key: `cases/${caseId}/documents/${documentId}/${versionId}`,
      contentType: input.mediaType,
      body: bytes,
    });

    const stored = await this.deps.documents.createDocumentWithVersion({
      documentId,
      versionId,
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      documentType: input.documentType,
      ownerType: 'employment_case',
      ownerId: null,
      sensitivity: input.sensitivity,
      complianceStatus: deriveComplianceStatus(expiresAt, now),
      expiresAt,
      storageKey,
      mediaType: input.mediaType,
      sizeBytes: bytes.byteLength,
      checksum: null,
      createdBy: actor.userId,
    });

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'document.uploaded',
      resourceType: 'document',
      resourceId: documentId,
      correlationId: actor.correlationId,
      occurredAt: now.toISOString(),
      // Document *type* only — never the file name, storage key, checksum or
      // any content (Constitution §16/§19).
      changeSummary: `Document type ${input.documentType} uploaded.`,
      sensitivity: input.sensitivity,
    });

    await this.deps.timeline.record({
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      eventTypeKey: 'timeline.document.uploaded',
      occurredAt: now.toISOString(),
      summaryKey: 'timeline.document.uploaded.summary',
      sensitivity: 'general',
    });

    return stored;
  }
}

export class ListCaseDocuments {
  constructor(
    private readonly deps: Pick<
      CaseDocumentDeps,
      'authorization' | 'documents' | 'audit' | 'clock'
    >,
  ) {}

  async execute(actor: Actor, caseId: string): Promise<DocumentWithCurrentVersion[]> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'document',
      action: 'read',
      caseId,
      sensitivity: 'identity_sensitive',
    });
    return this.deps.documents.listCaseDocuments(actor.tenantId, caseId);
  }
}

export interface DownloadUrl {
  url: string;
  expiresInSeconds: number;
}

/**
 * Issues a short-lived signed link. The authorization check runs *before* the
 * repository is touched and before the storage adapter is asked for a URL, so
 * a denied caller never causes a link to exist at all.
 */
export class GetDocumentDownloadUrl {
  constructor(
    private readonly deps: Pick<
      CaseDocumentDeps,
      'authorization' | 'documents' | 'storage' | 'audit' | 'clock'
    >,
  ) {}

  /** Returns null when the document is unknown, in another tenant, or has no file yet. */
  async execute(actor: Actor, caseId: string, documentId: string): Promise<DownloadUrl | null> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'document',
      action: 'read',
      caseId,
      resourceId: documentId,
      sensitivity: 'identity_sensitive',
    });

    const found = await this.deps.documents.findCaseDocument(actor.tenantId, caseId, documentId);
    if (!found?.currentVersion) {
      return null;
    }

    const url = await this.deps.storage.getSignedUrl(
      found.currentVersion.storageKey,
      DOWNLOAD_URL_TTL_SECONDS,
    );

    // Constitution §19 lists document download as an audited action: reading a
    // sensitive file is itself an event worth being able to reconstruct.
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'document.downloaded',
      resourceType: 'document',
      resourceId: documentId,
      correlationId: actor.correlationId,
      occurredAt: this.deps.clock.now().toISOString(),
      changeSummary: `Signed link issued for document type ${found.document.documentType}.`,
      sensitivity: found.document.sensitivity,
    });

    return { url, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
  }
}

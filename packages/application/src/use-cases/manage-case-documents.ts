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
import type { TaskRepository } from '../ports/task-repository.js';
import type { TimelineService } from '../ports/timeline-service.js';
import { AuthorizationError, type Actor } from './actor.js';
import { authorizeOrThrow } from './authorize.js';
import { findCaseHealthTaskFactor } from './case-health-factors.js';

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
  /**
   * Needed only so a document that lands 'valid' can auto-close the seeded
   * compliance task it satisfies — see completeMatchingSeededTask below.
   */
  tasks: TaskRepository;
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

/**
 * Closes the seeded compliance task a document just satisfied, e.g. the
 * "complete your passport details" task once a passport document is on file
 * and currently valid — NOT merely present. A document that exists but has
 * expired, or one that is still 'expiring', leaves the task open on purpose:
 * the health factor this task mirrors (`/cases/:caseId/health`) checks
 * `complianceStatus === 'valid'`, and a task that closed on upload alone
 * would go green while the case health score it is supposed to track stays
 * red — reintroducing exactly the "list that lies" problem this change
 * exists to fix.
 *
 * WHERE this lives: document upload/import (UploadCaseDocument,
 * ImportCaseDocument below) is the only place in the codebase that ever
 * computes or writes a document's complianceStatus — deriveComplianceStatus
 * runs once, at creation, and nothing today re-derives it later (no cron, no
 * separate "verify" transition; grep the repo for complianceStatus writes).
 * So the moment a document's status becomes 'valid' happens exactly once,
 * exactly here, which makes this the strongest place to react to it: no
 * polling, no second source of truth to keep in sync, and the completion
 * happens inside the same request that made the fact true, not on some later
 * page load or job run.
 *
 * WHO completes it: nobody clicked anything — an upload made a fact true and
 * the system noticed. `completedBy: null` follows the same convention
 * CollectDueProductSubscriptions uses for the billing cron
 * (`actorId: null // system cron; no human actor.` in manage-product-billing.ts):
 * an automatic action is never attributed to the human who merely triggered
 * the chain of events that led to it, because they did not perform it.
 *
 * WHAT ABOUT EXPIRY OR REMOVAL: not wired up, and deliberately so. There is
 * no code path in this system today that ever transitions a document's
 * complianceStatus away from 'valid' after creation (no recompute job, no
 * document-delete endpoint — migration 0047's task.source_key unique index
 * would in any case forbid inserting a second row under the same key while a
 * completed one already holds it, so "create a fresh task" was never on the
 * table without first reopening the old row). Building a reopen path with no
 * caller that can ever invoke it would be speculative dead code, which the
 * instructions for this change rank below doing nothing. When a compliance
 * recompute job is eventually added, it is the natural place to call
 * TaskRepository's completeTask-shaped counterpart to reopen a task — this
 * function does not need to anticipate that job's shape today.
 *
 * Never allowed to fail the upload/import it runs inside: the document is
 * already fully persisted, audited and timelined by the time this is called.
 * Unlike OpenEmploymentCase.seedComplianceTasks (which has no such guard and
 * can turn an already-written case into a 500), a document upload having
 * succeeded is the whole point of the request — a bookkeeping side effect on
 * top of it must not turn a successful upload into a failed one.
 */
async function completeMatchingSeededTask(
  deps: Pick<CaseDocumentDeps, 'tasks' | 'authorization' | 'audit' | 'timeline' | 'clock'>,
  actor: Actor,
  caseId: string,
  documentType: DocumentType,
  complianceStatus: DocumentComplianceStatus,
): Promise<void> {
  if (complianceStatus !== 'valid') return;
  const factor = findCaseHealthTaskFactor(documentType);
  if (!factor) return;

  try {
    // Deny-by-default still applies to this system-triggered write: an actor
    // who may upload a document but may not touch tasks does not get to close
    // one just because their upload happened to satisfy it.
    await authorizeOrThrow(deps, actor, {
      resourceType: 'task',
      action: 'update',
      caseId,
      sensitivity: 'employment_sensitive',
    });

    const now = deps.clock.now().toISOString();
    const completed = await deps.tasks.completeTaskBySourceKey(
      actor.tenantId,
      caseId,
      factor.sourceKey,
      now,
      // System completion: no human clicked anything (see function doc above).
      null,
    );
    // null means there was nothing to close — no seeded task exists (a case
    // opened before this factor existed, or it was already completed/
    // archived). Nothing to audit or timeline in that case.
    if (!completed) return;

    await deps.audit.record({
      tenantId: actor.tenantId,
      // System-derived, not a human decision — see AuditEventInput.actorId's
      // own null-for-system-actor convention.
      actorId: null,
      action: 'task.auto_completed',
      resourceType: 'task',
      resourceId: completed.id,
      correlationId: actor.correlationId,
      occurredAt: now,
      changeSummary: `Task auto-completed: a currently valid ${documentType} document now exists on the case.`,
      sensitivity: 'employment_sensitive',
    });

    await deps.timeline.record({
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      eventTypeKey: 'timeline.task.auto_completed',
      occurredAt: now,
      summaryKey: 'timeline.task.auto_completed.summary',
      sensitivity: 'general',
    });
  } catch (error) {
    // A denial here just means the task stays open — deny-by-default is still
    // honoured, nothing was completed. Any other failure (repository error,
    // audit/timeline hiccup) is swallowed for the same reason the whole
    // function is wrapped: the document upload already succeeded and must not
    // be turned into a 500 by a side effect on top of it.
    if (error instanceof AuthorizationError) return;
  }
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

    // See completeMatchingSeededTask's doc comment for why this runs here,
    // who it attributes the completion to, and why expiry/removal are not
    // handled. Never allowed to fail this already-successful upload.
    await completeMatchingSeededTask(
      this.deps,
      actor,
      caseId,
      input.documentType,
      stored.document.complianceStatus,
    );

    return stored;
  }
}

export interface ImportDocumentInput {
  documentType: DocumentType;
  sensitivity: SensitivityClass;
  /** Present when the browser record had a scanned file (MvpDocument.dataUrl); absent for metadata only. */
  file?: { mediaType: string; content: string };
  expiresOn?: string;
  legacyLocalId: string;
}

/**
 * Idempotent create for the UI cutover, mirroring ImportCaseTask. A device may
 * hold a document record with no scanned file at all (the family only noted
 * "we have a passport", never photographed it) — that case creates the
 * container with no version, exactly like a document nobody has uploaded a
 * file to yet, and the family can attach the scan later through the normal
 * upload flow.
 */
export class ImportCaseDocument {
  constructor(private readonly deps: CaseDocumentDeps) {}

  async execute(
    actor: Actor,
    caseId: string,
    input: ImportDocumentInput,
  ): Promise<DocumentWithCurrentVersion> {
    await authorizeOrThrow(this.deps, actor, {
      resourceType: 'document',
      action: 'create',
      caseId,
      sensitivity: input.sensitivity,
    });

    const existing = await this.deps.documents.findDocumentByLegacyLocalId(
      actor.tenantId,
      caseId,
      input.legacyLocalId,
    );
    if (existing) return existing;

    const now = this.deps.clock.now();
    const documentId = this.deps.ids.next();
    const expiresAt = input.expiresOn ? `${input.expiresOn}T00:00:00.000Z` : null;
    const complianceStatus = deriveComplianceStatus(expiresAt, now);

    let stored: DocumentWithCurrentVersion;
    if (input.file) {
      const versionId = this.deps.ids.next();
      const bytes = decodeBase64(input.file.content);
      const { storageKey } = await this.deps.storage.putObject({
        tenantId: actor.tenantId,
        key: `cases/${caseId}/documents/${documentId}/${versionId}`,
        contentType: input.file.mediaType,
        body: bytes,
      });
      stored = await this.deps.documents.createDocumentWithVersion({
        documentId,
        versionId,
        tenantId: actor.tenantId,
        employmentCaseId: caseId,
        documentType: input.documentType,
        ownerType: 'employment_case',
        ownerId: null,
        sensitivity: input.sensitivity,
        complianceStatus,
        expiresAt,
        storageKey,
        mediaType: input.file.mediaType,
        sizeBytes: bytes.byteLength,
        checksum: null,
        createdBy: actor.userId,
        legacyLocalId: input.legacyLocalId,
      });
    } else {
      stored = await this.deps.documents.createDocument({
        documentId,
        tenantId: actor.tenantId,
        employmentCaseId: caseId,
        documentType: input.documentType,
        ownerType: 'employment_case',
        ownerId: null,
        sensitivity: input.sensitivity,
        complianceStatus,
        expiresAt,
        createdBy: actor.userId,
        legacyLocalId: input.legacyLocalId,
      });
    }

    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'document.imported',
      resourceType: 'document',
      resourceId: documentId,
      correlationId: actor.correlationId,
      occurredAt: now.toISOString(),
      changeSummary: `Document type ${input.documentType} imported from local device record.`,
      sensitivity: input.sensitivity,
    });

    await this.deps.timeline.record({
      tenantId: actor.tenantId,
      employmentCaseId: caseId,
      eventTypeKey: 'timeline.document.imported',
      occurredAt: now.toISOString(),
      summaryKey: 'timeline.document.imported.summary',
      sensitivity: 'general',
    });

    // See completeMatchingSeededTask's doc comment. Only reached on an actual
    // new import (the legacyLocalId idempotency check above returns early on
    // a repeat, before any of this), so a replayed import cannot re-trigger it.
    await completeMatchingSeededTask(
      this.deps,
      actor,
      caseId,
      input.documentType,
      stored.document.complianceStatus,
    );

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

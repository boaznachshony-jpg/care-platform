import { describe, expect, it } from 'vitest';
import {
  AuthorizationError,
  GetDocumentDownloadUrl,
  ImportCaseDocument,
  ListCaseDocuments,
  UploadCaseDocument,
  deriveComplianceStatus,
  type Actor,
} from '@caredesk/application';
import { FixedClock } from './clock.js';
import { SequentialIdGenerator } from './id-generator.js';
import { InMemoryAuditService } from './in-memory-audit-service.js';
import { InMemoryDocumentRepository } from './in-memory-document-repository.js';
import { InMemoryDocumentStorage } from './in-memory-document-storage.js';
import { InMemoryTaskRepository } from './in-memory-task-repository.js';
import { InMemoryTimelineService } from './in-memory-timeline-service.js';
import { MembershipAuthorizationService } from './membership-authorization-service.js';

const ROLE_PERMISSIONS = {
  owner: ['document:create', 'document:read', 'task:update', 'task:create'],
  // Can upload documents, but has no task permission at all — proves the
  // auto-completion is deny-by-default too, not a bypass of task authorization.
  uploader_no_task_access: ['document:create', 'document:read'],
  family_member: ['document:read'],
  // A role with no document permission at all — proves deny-by-default.
  outsider: [],
} as const;

const OWNER: Actor = { userId: 'user-1', tenantId: 'tenant-1', correlationId: 'corr-1' };
const VIEWER: Actor = { userId: 'user-2', tenantId: 'tenant-1', correlationId: 'corr-2' };
const OUTSIDER: Actor = { userId: 'user-3', tenantId: 'tenant-1', correlationId: 'corr-3' };
const UPLOADER_NO_TASK_ACCESS: Actor = {
  userId: 'user-4',
  tenantId: 'tenant-1',
  correlationId: 'corr-4',
};
const CASE_ID = 'case-1';
const NOW = new Date('2026-03-01T09:00:00.000Z');

/** Synthetic bytes only (Constitution §25) — the string "synthetic-pdf-bytes". */
const CONTENT = Buffer.from('synthetic-pdf-bytes').toString('base64');

function buildHarness() {
  const authorization = new MembershipAuthorizationService(ROLE_PERMISSIONS);
  authorization.seedMembership({ ...OWNER, role: 'owner', status: 'active' });
  authorization.seedMembership({ ...VIEWER, role: 'family_member', status: 'active' });
  authorization.seedMembership({ ...OUTSIDER, role: 'outsider', status: 'active' });
  authorization.seedMembership({
    ...UPLOADER_NO_TASK_ACCESS,
    role: 'uploader_no_task_access',
    status: 'active',
  });

  const documents = new InMemoryDocumentRepository();
  const storage = new InMemoryDocumentStorage();
  const audit = new InMemoryAuditService();
  const timeline = new InMemoryTimelineService();
  const tasks = new InMemoryTaskRepository();
  const ids = new SequentialIdGenerator();
  const deps = {
    authorization,
    documents,
    storage,
    audit,
    timeline,
    clock: new FixedClock(NOW),
    ids,
    tasks,
  };

  return {
    audit,
    timeline,
    storage,
    tasks,
    ids,
    upload: new UploadCaseDocument(deps),
    import: new ImportCaseDocument(deps),
    list: new ListCaseDocuments(deps),
    downloadUrl: new GetDocumentDownloadUrl(deps),
  };
}

const UPLOAD = {
  documentType: 'passport',
  sensitivity: 'identity_sensitive',
  mediaType: 'application/pdf',
  content: CONTENT,
} as const;

describe('uploading a case document', () => {
  it('stores the file, audits the upload, and records a timeline event', async () => {
    const h = buildHarness();
    const { document, currentVersion } = await h.upload.execute(OWNER, CASE_ID, { ...UPLOAD });

    expect(document.documentType).toBe('passport');
    expect(document.complianceStatus).toBe('valid');
    expect(currentVersion?.versionNumber).toBe(1);
    expect(currentVersion?.verificationStatus).toBe('uploaded');
    expect(currentVersion?.sizeBytes).toBe('synthetic-pdf-bytes'.length);

    expect(h.audit.events.map((e) => e.action)).toContain('document.uploaded');
    expect(h.timeline.events.map((e) => e.eventTypeKey)).toContain('timeline.document.uploaded');
  });

  it('never puts the storage key, checksum, or file content in the audit record', async () => {
    const h = buildHarness();
    const { currentVersion } = await h.upload.execute(OWNER, CASE_ID, { ...UPLOAD });
    const event = h.audit.events.find((e) => e.action === 'document.uploaded');

    expect(event?.changeSummary).not.toContain(currentVersion?.storageKey ?? 'storage-key');
    expect(event?.changeSummary).not.toContain(CONTENT);
    expect(event?.changeSummary).not.toContain('synthetic-pdf-bytes');
    // The document type is what an auditor legitimately needs.
    expect(event?.changeSummary).toContain('passport');
  });

  it('stores an expiry at day start so it cannot drift to the previous day', async () => {
    const h = buildHarness();
    const { document } = await h.upload.execute(OWNER, CASE_ID, {
      ...UPLOAD,
      expiresOn: '2026-09-01',
    });
    expect(document.expiresAt).toBe('2026-09-01T00:00:00.000Z');
    expect(document.complianceStatus).toBe('valid');
  });

  it('derives an expiring status inside the 30-day window and expired past it', async () => {
    expect(deriveComplianceStatus('2026-03-15T00:00:00.000Z', NOW)).toBe('expiring');
    expect(deriveComplianceStatus('2026-02-01T00:00:00.000Z', NOW)).toBe('expired');
    expect(deriveComplianceStatus(null, NOW)).toBe('valid');
  });

  it('denies upload to a read-only role', async () => {
    const h = buildHarness();
    await expect(h.upload.execute(VIEWER, CASE_ID, { ...UPLOAD })).rejects.toThrow(
      AuthorizationError,
    );
  });
});

describe('listing case documents', () => {
  it('is readable by a read-only role', async () => {
    const h = buildHarness();
    await h.upload.execute(OWNER, CASE_ID, { ...UPLOAD });
    await h.upload.execute(OWNER, CASE_ID, { ...UPLOAD, documentType: 'visa' });
    expect(await h.list.execute(VIEWER, CASE_ID)).toHaveLength(2);
  });

  it('denies listing to a role with no document permission', async () => {
    const h = buildHarness();
    await expect(h.list.execute(OUTSIDER, CASE_ID)).rejects.toThrow(AuthorizationError);
  });
});

describe('issuing a download URL', () => {
  it('returns a short-lived signed link and audits the download', async () => {
    const h = buildHarness();
    const { document } = await h.upload.execute(OWNER, CASE_ID, { ...UPLOAD });

    const link = await h.downloadUrl.execute(VIEWER, CASE_ID, document.id);
    expect(link?.expiresInSeconds).toBe(900);
    expect(link?.url).toContain('mock://signed/');
    // Constitution §19: reading a sensitive file is itself an audited event.
    expect(h.audit.events.map((e) => e.action)).toContain('document.downloaded');
  });

  it('issues NO download URL when authorization fails, and records the refusal', async () => {
    const h = buildHarness();
    const { document } = await h.upload.execute(OWNER, CASE_ID, { ...UPLOAD });
    const auditedBefore = h.audit.events.length;

    await expect(h.downloadUrl.execute(OUTSIDER, CASE_ID, document.id)).rejects.toThrow(
      AuthorizationError,
    );

    // No link was created and nothing was recorded as a download...
    expect(h.audit.events.map((e) => e.action)).not.toContain('document.downloaded');

    // ...but the refused attempt is itself audited (Constitution §19). An
    // attempt to reach a file the caller may not see is exactly the event
    // worth investigating, so it must not pass silently.
    expect(h.audit.events).toHaveLength(auditedBefore + 1);
    const denial = h.audit.events[auditedBefore];
    expect(denial?.action).toBe('document.read.denied');
    expect(denial?.permissionDecision).toBe('denied');
    expect(denial?.reason).toBeTruthy();
    expect(denial?.resourceId).toBe(document.id);
  });

  it('returns null for a document on another case rather than revealing it exists', async () => {
    const h = buildHarness();
    const { document } = await h.upload.execute(OWNER, CASE_ID, { ...UPLOAD });
    expect(await h.downloadUrl.execute(OWNER, 'case-2', document.id)).toBeNull();
  });

  it('returns null for an unknown document id', async () => {
    const h = buildHarness();
    expect(await h.downloadUrl.execute(OWNER, CASE_ID, 'no-such-document')).toBeNull();
  });
});

describe('importing a browser-only document (UI cutover)', () => {
  it('creates a document with no file when the local record had no scan', async () => {
    const h = buildHarness();
    const { document, currentVersion } = await h.import.execute(OWNER, CASE_ID, {
      documentType: 'passport',
      sensitivity: 'identity_sensitive',
      legacyLocalId: 'local-doc-1',
    });
    expect(currentVersion).toBeNull();
    expect(document.currentVersionId).toBeNull();
    expect(document.status).toBe('active');
  });

  it('creates a document with a file when the local record had a scan', async () => {
    const h = buildHarness();
    const { currentVersion } = await h.import.execute(OWNER, CASE_ID, {
      documentType: 'passport',
      sensitivity: 'identity_sensitive',
      file: { mediaType: 'application/pdf', content: CONTENT },
      legacyLocalId: 'local-doc-2',
    });
    expect(currentVersion?.versionNumber).toBe(1);
  });

  it('is idempotent on legacyLocalId — a repeated import returns the same document', async () => {
    const h = buildHarness();
    const first = await h.import.execute(OWNER, CASE_ID, {
      documentType: 'passport',
      sensitivity: 'identity_sensitive',
      legacyLocalId: 'local-doc-3',
    });
    const second = await h.import.execute(OWNER, CASE_ID, {
      documentType: 'passport',
      sensitivity: 'identity_sensitive',
      legacyLocalId: 'local-doc-3',
    });
    expect(second.document.id).toBe(first.document.id);
    expect(h.audit.events.filter((e) => e.action === 'document.imported')).toHaveLength(1);
  });

  it('denies import to a read-only role', async () => {
    const h = buildHarness();
    await expect(
      h.import.execute(VIEWER, CASE_ID, {
        documentType: 'passport',
        sensitivity: 'identity_sensitive',
        legacyLocalId: 'local-doc-4',
      }),
    ).rejects.toThrow(AuthorizationError);
  });
});

/**
 * The gap this change closes: a first import that carried metadata only
 * (browser hadn't resolved the file's bytes yet) used to permanently discard
 * any file a later retry of the same legacyLocalId carried, because the
 * idempotency check returned early before ever looking at `input.file`.
 */
describe('a later import that finally carries the file attaches it', () => {
  it('attaches the file as the first version when the existing document had none', async () => {
    const h = buildHarness();
    const metadataOnly = await h.import.execute(OWNER, CASE_ID, {
      documentType: 'passport',
      sensitivity: 'identity_sensitive',
      legacyLocalId: 'local-doc-attach-1',
    });
    expect(metadataOnly.currentVersion).toBeNull();

    const attached = await h.import.execute(OWNER, CASE_ID, {
      documentType: 'passport',
      sensitivity: 'identity_sensitive',
      file: { mediaType: 'application/pdf', content: CONTENT },
      legacyLocalId: 'local-doc-attach-1',
    });

    expect(attached.document.id).toBe(metadataOnly.document.id);
    expect(attached.currentVersion?.versionNumber).toBe(1);
    expect(attached.currentVersion?.sizeBytes).toBe('synthetic-pdf-bytes'.length);

    // A real event distinct from 'document.imported', which already fired for
    // the metadata-only container.
    expect(h.audit.events.map((e) => e.action)).toContain('document.file_attached');
    expect(h.timeline.events.map((e) => e.eventTypeKey)).toContain(
      'timeline.document.file_attached',
    );
  });

  it('never puts file bytes or the storage key in the file_attached audit record', async () => {
    const h = buildHarness();
    await h.import.execute(OWNER, CASE_ID, {
      documentType: 'passport',
      sensitivity: 'identity_sensitive',
      legacyLocalId: 'local-doc-attach-2',
    });
    const attached = await h.import.execute(OWNER, CASE_ID, {
      documentType: 'passport',
      sensitivity: 'identity_sensitive',
      file: { mediaType: 'application/pdf', content: CONTENT },
      legacyLocalId: 'local-doc-attach-2',
    });

    const event = h.audit.events.find((e) => e.action === 'document.file_attached');
    expect(event?.changeSummary).not.toContain(attached.currentVersion?.storageKey ?? 'x');
    expect(event?.changeSummary).not.toContain(CONTENT);
    expect(event?.changeSummary).not.toContain('synthetic-pdf-bytes');
    expect(event?.changeSummary).toContain('passport');
  });

  it('does not attach a second version when the retry is replayed again', async () => {
    const h = buildHarness();
    await h.import.execute(OWNER, CASE_ID, {
      documentType: 'passport',
      sensitivity: 'identity_sensitive',
      legacyLocalId: 'local-doc-attach-3',
    });
    const first = await h.import.execute(OWNER, CASE_ID, {
      documentType: 'passport',
      sensitivity: 'identity_sensitive',
      file: { mediaType: 'application/pdf', content: CONTENT },
      legacyLocalId: 'local-doc-attach-3',
    });
    const second = await h.import.execute(OWNER, CASE_ID, {
      documentType: 'passport',
      sensitivity: 'identity_sensitive',
      file: { mediaType: 'application/pdf', content: CONTENT },
      legacyLocalId: 'local-doc-attach-3',
    });

    expect(second.currentVersion?.id).toBe(first.currentVersion?.id);
    expect(second.currentVersion?.versionNumber).toBe(1);
    expect(h.audit.events.filter((e) => e.action === 'document.file_attached')).toHaveLength(1);
  });

  it('leaves a document that already has a version alone — no phantom re-upload', async () => {
    const h = buildHarness();
    // This import already carries the file on its first run.
    const withFile = await h.import.execute(OWNER, CASE_ID, {
      documentType: 'passport',
      sensitivity: 'identity_sensitive',
      file: { mediaType: 'application/pdf', content: CONTENT },
      legacyLocalId: 'local-doc-attach-4',
    });

    // A later retry carrying a (possibly different) file must not add a
    // second version — the family never re-scanned anything.
    const otherContent = Buffer.from('a-different-synthetic-pdf').toString('base64');
    const replayed = await h.import.execute(OWNER, CASE_ID, {
      documentType: 'passport',
      sensitivity: 'identity_sensitive',
      file: { mediaType: 'application/pdf', content: otherContent },
      legacyLocalId: 'local-doc-attach-4',
    });

    expect(replayed.currentVersion?.id).toBe(withFile.currentVersion?.id);
    expect(replayed.currentVersion?.versionNumber).toBe(1);
    expect(h.audit.events.filter((e) => e.action === 'document.file_attached')).toHaveLength(0);
  });

  it('denies the attach path to a read-only role exactly like a fresh import', async () => {
    const h = buildHarness();
    await h.import.execute(OWNER, CASE_ID, {
      documentType: 'passport',
      sensitivity: 'identity_sensitive',
      legacyLocalId: 'local-doc-attach-5',
    });

    await expect(
      h.import.execute(VIEWER, CASE_ID, {
        documentType: 'passport',
        sensitivity: 'identity_sensitive',
        file: { mediaType: 'application/pdf', content: CONTENT },
        legacyLocalId: 'local-doc-attach-5',
      }),
    ).rejects.toThrow(AuthorizationError);
  });

  it('does not re-trigger seeded task completion on attach — complianceStatus is unchanged by it', async () => {
    const h = buildHarness();
    const seeded = await h.tasks.createTask({
      id: h.ids.next(),
      tenantId: OWNER.tenantId,
      employmentCaseId: CASE_ID,
      titleKey: 'tasks.seeded.passport',
      description: null,
      priority: 'high',
      dueAt: null,
      createdBy: OWNER.userId,
      sourceKey: 'case_health:passport',
      sourceType: 'rule',
    });

    // No expiry set: deriveComplianceStatus(null, now) is 'valid' — so the
    // metadata-only import already auto-completes the seeded task, before any
    // file exists. This documents the existing, file-presence-agnostic
    // compliance model that the attach path deliberately does not disturb.
    await h.import.execute(OWNER, CASE_ID, {
      documentType: 'passport',
      sensitivity: 'identity_sensitive',
      legacyLocalId: 'local-doc-attach-6',
    });
    expect((await h.tasks.findTask(OWNER.tenantId, seeded.id))?.status).toBe('completed');
    const completedCountAfterMetadata = h.audit.events.filter(
      (e) => e.action === 'task.auto_completed',
    ).length;

    await h.import.execute(OWNER, CASE_ID, {
      documentType: 'passport',
      sensitivity: 'identity_sensitive',
      file: { mediaType: 'application/pdf', content: CONTENT },
      legacyLocalId: 'local-doc-attach-6',
    });

    expect(h.audit.events.filter((e) => e.action === 'task.auto_completed')).toHaveLength(
      completedCountAfterMetadata,
    );
  });
});

/**
 * The gap this change closes: a seeded compliance task (OpenEmploymentCase)
 * must close itself once the document it was asking for is actually on file
 * and currently valid — not merely uploaded.
 */
describe('a document landing valid auto-completes the matching seeded task', () => {
  async function seedPassportTask(h: ReturnType<typeof buildHarness>) {
    return h.tasks.createTask({
      id: h.ids.next(),
      tenantId: OWNER.tenantId,
      employmentCaseId: CASE_ID,
      titleKey: 'tasks.seeded.passport',
      description: null,
      priority: 'high',
      dueAt: null,
      createdBy: OWNER.userId,
      sourceKey: 'case_health:passport',
      sourceType: 'rule',
    });
  }

  it('completes the seeded task when a valid document of the matching type is uploaded', async () => {
    const h = buildHarness();
    const seeded = await seedPassportTask(h);

    await h.upload.execute(OWNER, CASE_ID, { ...UPLOAD, documentType: 'passport' });

    const task = await h.tasks.findTask(OWNER.tenantId, seeded.id);
    expect(task?.status).toBe('completed');

    // Attributed to the system, not the uploading human — nobody clicked
    // "complete task"; an upload made the underlying fact true.
    const completion = h.audit.events.find((e) => e.action === 'task.auto_completed');
    expect(completion?.actorId).toBeNull();
    expect(completion?.resourceId).toBe(seeded.id);
    expect(h.timeline.events.map((e) => e.eventTypeKey)).toContain('timeline.task.auto_completed');
  });

  it('leaves the seeded task open when the uploaded document is already expired', async () => {
    const h = buildHarness();
    const seeded = await seedPassportTask(h);

    // 2026-01-01 is well before NOW (2026-03-01) — derives to 'expired', not 'valid'.
    await h.upload.execute(OWNER, CASE_ID, {
      ...UPLOAD,
      documentType: 'passport',
      expiresOn: '2026-01-01',
    });

    const task = await h.tasks.findTask(OWNER.tenantId, seeded.id);
    expect(task?.status).toBe('open');
    expect(h.audit.events.map((e) => e.action)).not.toContain('task.auto_completed');
  });

  it('does nothing when no seeded task exists for the document type (case predates seeding, or already closed)', async () => {
    const h = buildHarness();
    await h.upload.execute(OWNER, CASE_ID, { ...UPLOAD, documentType: 'passport' });
    // No task was ever seeded — completeTaskBySourceKey has nothing to find.
    expect(h.audit.events.map((e) => e.action)).not.toContain('task.auto_completed');
  });

  it('never completes twice — a second valid upload of the same type is a no-op on the task', async () => {
    const h = buildHarness();
    const seeded = await seedPassportTask(h);

    await h.upload.execute(OWNER, CASE_ID, { ...UPLOAD, documentType: 'passport' });
    await h.upload.execute(OWNER, CASE_ID, { ...UPLOAD, documentType: 'passport' });

    expect(h.audit.events.filter((e) => e.action === 'task.auto_completed')).toHaveLength(1);
    const task = await h.tasks.findTask(OWNER.tenantId, seeded.id);
    expect(task?.status).toBe('completed');
  });

  it('completes the seeded task on an import that carries a scan and derives valid', async () => {
    const h = buildHarness();
    const seeded = await seedPassportTask(h);

    await h.import.execute(OWNER, CASE_ID, {
      documentType: 'passport',
      sensitivity: 'identity_sensitive',
      file: { mediaType: 'application/pdf', content: CONTENT },
      legacyLocalId: 'local-doc-5',
    });

    const task = await h.tasks.findTask(OWNER.tenantId, seeded.id);
    expect(task?.status).toBe('completed');
  });

  it('leaves the task open — and the upload still succeeds — for an actor with no task permission', async () => {
    const h = buildHarness();
    const seeded = await seedPassportTask(h);

    // UPLOADER_NO_TASK_ACCESS can create documents but holds no task:* grant
    // at all: deny-by-default applies to the automatic completion exactly as
    // it would to a manual one, and the failed side effect must not fail the
    // (already authorized, already successful) upload itself.
    const { document } = await h.upload.execute(UPLOADER_NO_TASK_ACCESS, CASE_ID, {
      ...UPLOAD,
      documentType: 'passport',
    });

    expect(document.complianceStatus).toBe('valid');
    const task = await h.tasks.findTask(OWNER.tenantId, seeded.id);
    expect(task?.status).toBe('open');
    expect(h.audit.events.map((e) => e.action)).not.toContain('task.auto_completed');
  });
});

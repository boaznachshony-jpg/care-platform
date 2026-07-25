import { describe, expect, it } from 'vitest';
import {
  AuthorizationError,
  GetDocumentDownloadUrl,
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
import { InMemoryTimelineService } from './in-memory-timeline-service.js';
import { MembershipAuthorizationService } from './membership-authorization-service.js';

const ROLE_PERMISSIONS = {
  owner: ['document:create', 'document:read'],
  family_member: ['document:read'],
  // A role with no document permission at all — proves deny-by-default.
  outsider: [],
} as const;

const OWNER: Actor = { userId: 'user-1', tenantId: 'tenant-1', correlationId: 'corr-1' };
const VIEWER: Actor = { userId: 'user-2', tenantId: 'tenant-1', correlationId: 'corr-2' };
const OUTSIDER: Actor = { userId: 'user-3', tenantId: 'tenant-1', correlationId: 'corr-3' };
const CASE_ID = 'case-1';
const NOW = new Date('2026-03-01T09:00:00.000Z');

/** Synthetic bytes only (Constitution §25) — the string "synthetic-pdf-bytes". */
const CONTENT = Buffer.from('synthetic-pdf-bytes').toString('base64');

function buildHarness() {
  const authorization = new MembershipAuthorizationService(ROLE_PERMISSIONS);
  authorization.seedMembership({ ...OWNER, role: 'owner', status: 'active' });
  authorization.seedMembership({ ...VIEWER, role: 'family_member', status: 'active' });
  authorization.seedMembership({ ...OUTSIDER, role: 'outsider', status: 'active' });

  const documents = new InMemoryDocumentRepository();
  const storage = new InMemoryDocumentStorage();
  const audit = new InMemoryAuditService();
  const timeline = new InMemoryTimelineService();
  const deps = {
    authorization,
    documents,
    storage,
    audit,
    timeline,
    clock: new FixedClock(NOW),
    ids: new SequentialIdGenerator(),
  };

  return {
    audit,
    timeline,
    storage,
    upload: new UploadCaseDocument(deps),
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

  it('issues NO download URL when authorization fails', async () => {
    const h = buildHarness();
    const { document } = await h.upload.execute(OWNER, CASE_ID, { ...UPLOAD });
    const auditedBefore = h.audit.events.length;

    await expect(h.downloadUrl.execute(OUTSIDER, CASE_ID, document.id)).rejects.toThrow(
      AuthorizationError,
    );
    // No link was created, and nothing was recorded as a download.
    expect(h.audit.events).toHaveLength(auditedBefore);
    expect(h.audit.events.map((e) => e.action)).not.toContain('document.downloaded');
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

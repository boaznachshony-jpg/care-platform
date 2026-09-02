/* eslint-disable no-restricted-syntax */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  deleteDocumentFile,
  readDocumentFile,
  saveDocumentFile,
} from '../storage/document-file-store.js';
import {
  readMvpDocuments,
  saveMvpDocuments,
  type MvpDocument,
  type MvpDocumentStatus,
} from '../storage/mvp-storage.js';
import { MAX_DOCUMENT_BYTES } from '@caredesk/schemas';
import { useAuth } from '../auth/auth-context.js';
import { importCaseDocument, listCaseDocuments } from '../api/client.js';
import { LEGACY_UNSCOPED_CLIENT_ID } from '../canonical-case.js';
import { useLegacyClientId } from '../hooks/use-legacy-client-id.js';
import { useCaseForLegacyClient } from '../sync/use-case-for-legacy-client.js';
import {
  rememberUploadedServerId,
  uploadUnsyncedRecords,
  type SyncStatus,
} from '../sync/legacy-upload.js';
import {
  dateLabelToIsoDate,
  documentResponseToLocal,
  localCategoryToDocumentType,
  resolveDocumentImportFile,
} from '../sync/document-mapping.js';
import {
  classifyExpiry,
  extractIsoDateFromLabel,
  type ExpiryClassification,
} from '../date-diff.js';

/**
 * Defect 3 fix: this used to be a hardcoded 10 MB, twice the server's real
 * cap (`MAX_DOCUMENT_BYTES`, packages/schemas — 5 MiB). A file between the
 * two limits passed this screen's own check, got "recorded" locally, and
 * then silently lost its scan on the next sync (see resolveDocumentImportFile
 * in sync/document-mapping.ts for the other half of that fix). Importing the
 * same constant the server enforces means this screen can never again accept
 * a file the server will not.
 *
 * Rejected here, at selection/save time, rather than only reported after a
 * failed background sync: the family is looking at the form right now with
 * the file already picked, which is the cheapest possible moment to say
 * "pick a smaller file" — before a base64 read/encode, before a network
 * round trip, and before the record even exists locally with a promise this
 * screen cannot keep. A background-only rejection (letting the too-large
 * file save locally and failing it during sync) is a strictly worse version
 * of the same information delivered later and further from the fix.
 */
const MAX_FILE_SIZE = MAX_DOCUMENT_BYTES;
const ALLOWED_FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

const toDateInputValue = dateLabelToIsoDate;

function formatExpiryDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `בתוקף עד ${day}.${month}.${year}`;
}

/**
 * The badge on this screen answers one question — "is this document still
 * valid" — and used to answer it purely from whatever was picked in the
 * "מצב" dropdown when the document was saved, with no link back to the
 * expiry date itself. A passport that expired six months ago kept its green
 * "תקין" badge until someone remembered to edit it by hand: the one screen
 * whose job is to catch an expired document could not.
 *
 * The fix derives the badge from the expiry date using the same 14/30-day
 * windows as the rest of the app (see date-diff.ts), with one deliberate
 * exception for the manual "מצב" field rather than deleting it outright:
 *
 * - No expiry date at all: many document types genuinely have none (e.g. a
 *   bank confirmation letter), so a missing date is not "expired" — the
 *   manual choice is the only signal available and stands unchanged.
 * - An expiry date that is today, in the past, or inside the 14/30-day
 *   windows: the badge must say "דורש טיפול" (or "פג תוקף" once actually
 *   expired) regardless of what was picked, or forgotten, in the form —
 *   this is exactly the bug being fixed, so the date always wins here.
 * - A human who picked "דורש טיפול" may be flagging something no date can
 *   see (an illegible scan, a document under dispute...). That judgement is
 *   never silently thrown away by a comfortable expiry date — it can only
 *   push the badge to "דורש טיפול", never pull it back to "תקין".
 */
function documentDisplayStatus(
  document: MvpDocument,
  today: Date = new Date(),
): { status: MvpDocumentStatus; classification: ExpiryClassification } {
  const expiryIso = extractIsoDateFromLabel(document.dateLabel);
  const classification = classifyExpiry(expiryIso, today);
  if (classification === 'no-date') return { status: document.status, classification };
  const dateSaysAttention = classification !== 'ok';
  const status: MvpDocumentStatus =
    dateSaysAttention || document.status === 'attention' ? 'attention' : 'valid';
  return { status, classification };
}

const emptyDraft = {
  name: '',
  category: 'מסמך אחר',
  dateLabel: '',
  status: 'valid' as MvpDocumentStatus,
};

export function DocumentsPage() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [documents, setDocuments] = useState(readMvpDocuments);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const legacyClientIdParam = useLegacyClientId();
  const caseLookup = useCaseForLegacyClient(legacyClientIdParam);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ phase: 'checking' });
  const [syncAttempt, setSyncAttempt] = useState(0);

  useEffect(() => {
    if (caseLookup.status !== 'found') {
      setSyncStatus(
        caseLookup.status === 'checking'
          ? { phase: 'checking' }
          : caseLookup.status === 'ambiguous'
            ? { phase: 'ambiguous' }
            : { phase: 'no-case' },
      );
      return;
    }
    const caseId = caseLookup.caseId;
    // clientIdFromPath()-style sentinel handling: DocumentsPage is mounted
    // both scoped (`/clients/:clientId/documents`) and unscoped (`/documents`)
    // — useLegacyClientId() returns LEGACY_UNSCOPED_CLIENT_ID on the latter,
    // which is not a real client and must not be sent to the workspace-file
    // lookup in resolveDocumentImportFile (it would 404 or, worse, collide).
    const legacyClientId =
      legacyClientIdParam === LEGACY_UNSCOPED_CLIENT_ID ? null : legacyClientIdParam;
    let active = true;

    async function run() {
      const localNow = readMvpDocuments();
      if (localNow.length === 0) {
        setSyncStatus({ phase: 'checking' });
      } else {
        setSyncStatus({ phase: 'uploading', completed: 0, total: localNow.length });
      }
      const outcome = await uploadUnsyncedRecords(
        'documents',
        caseId,
        localNow,
        async (localDocument) => {
          // See document-mapping.ts's resolveDocumentImportFile for the full
          // order of places a file may live; this never throws for "no file
          // found" (normal), only for a genuine fetch failure on bytes known
          // to exist, which is exactly what should make this record retryable.
          const importFile = await resolveDocumentImportFile(localDocument, legacyClientId);
          return importCaseDocument(caseId, {
            legacyLocalId: localDocument.id,
            documentType: localCategoryToDocumentType(localDocument.category),
            sensitivity: 'identity_sensitive',
            file: importFile,
            expiresOn: dateLabelToIsoDate(localDocument.dateLabel) || undefined,
          });
        },
        (completed, total) => {
          if (active) setSyncStatus({ phase: 'uploading', completed, total });
        },
      );
      if (!active) return;
      if (outcome.failedIds.length > 0) {
        setSyncStatus({ phase: 'upload-failed', failedCount: outcome.failedIds.length });
        return;
      }

      try {
        const serverDocuments = await listCaseDocuments(caseId);
        if (!active) return;
        // Defect 1 & 2 fix: a matched local record is left exactly as it is.
        // This used to spread `documentResponseToLocal(match)` over the local
        // record — category, name, date and status all got overwritten with
        // whatever the server happened to hold. The server copy can be
        // *older* than what is on screen (this browser's own earlier import,
        // possibly seconds stale by the time the read-back lands, or another
        // device's copy) — local is where the customer just typed, and
        // overwriting it with an older value is exactly the silent-revert bug
        // this fixes. It also doubled as Defect 2: "אישור בנק" (a category
        // this cutover has no canonical twin for — see CATEGORY_TO_DOCUMENT_TYPE
        // in sync/document-mapping.ts) round-tripped through the server's
        // generic `other` type and came back as "מסמך אחר", quietly replacing
        // the family's own wording. Never applying the server copy over an
        // existing local one fixes both at once: the canonical `documentType`
        // can still legitimately be `other`, but the label the customer typed
        // is local data and stays local, unconditionally.
        //
        // There is currently no document *update* endpoint (see the PR
        // report), so an edit made here after the first successful import has
        // no way to reach the server at all — this only guarantees the local
        // edit is never destroyed, not that it propagates. That is the
        // correct trade-off per Constitution §13/"never delete or overwrite
        // local data": showing a stale-but-honest local copy beats silently
        // reverting to what the server has.
        const merged = readMvpDocuments();
        for (const serverDocument of serverDocuments) {
          if (serverDocument.legacyLocalId) continue;
          if (merged.some((document) => document.id === serverDocument.id)) continue;
          rememberUploadedServerId('documents', caseId, serverDocument.id, serverDocument.id);
          merged.push(documentResponseToLocal(serverDocument));
        }
        saveMvpDocuments(merged);
        setDocuments(merged);
        setSyncStatus({ phase: 'synced' });
      } catch {
        setSyncStatus({ phase: 'offline' });
      }
    }

    void run();
    return () => {
      active = false;
    };
  }, [caseLookup, legacyClientIdParam, syncAttempt]);

  function persist(next: MvpDocument[]) {
    saveMvpDocuments(next);
    setDocuments(next);
    if (caseLookup.status === 'found') setSyncAttempt((count) => count + 1);
  }

  function startEdit(document: MvpDocument) {
    setDraft({
      name: document.name,
      category: document.category,
      dateLabel: toDateInputValue(document.dateLabel),
      status: document.status,
    });
    setEditingId(document.id);
    setFile(null);
    setShowForm(true);
    setMessage('');
  }

  function resetForm() {
    setDraft(emptyDraft);
    setEditingId(null);
    setFile(null);
    setShowForm(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function saveDocument(event: React.FormEvent) {
    event.preventDefault();
    try {
      const existing = documents.find((document) => document.id === editingId);
      if (!existing && !file) {
        setMessage('יש לבחור קובץ לפני השמירה.');
        return;
      }
      if (file && file.size > MAX_FILE_SIZE) {
        setMessage('הקובץ גדול מדי. ניתן להעלות PDF או תמונה עד 5MB.');
        return;
      }
      if (file && !ALLOWED_FILE_TYPES.includes(file.type)) {
        setMessage('סוג הקובץ אינו נתמך. ניתן להעלות PDF, JPG או PNG.');
        return;
      }

      const id = existing?.id ?? crypto.randomUUID();
      if (file) await saveDocumentFile(id, file);

      const saved: MvpDocument = {
        id,
        name: draft.name,
        category: draft.category,
        dateLabel: formatExpiryDate(draft.dateLabel),
        status: draft.status,
        fileName: file?.name ?? existing?.fileName ?? '',
        fileType: file?.type ?? existing?.fileType ?? '',
        updatedAt: new Date().toISOString(),
      };
      persist(
        existing
          ? documents.map((item) => (item.id === existing.id ? saved : item))
          : [saved, ...documents],
      );
      resetForm();
      setMessage(existing ? 'פרטי המסמך עודכנו ונשמרו.' : 'המסמך נוסף ונשמר.');
    } catch {
      setMessage(
        'לא ניתן היה לשמור את הקובץ במכשיר. ודאו שהגלישה אינה במצב פרטי ושיש שטח אחסון פנוי.',
      );
    }
  }

  async function openDocument(document: MvpDocument) {
    const storedFile = await readDocumentFile(document.id);
    const href =
      typeof storedFile === 'string'
        ? storedFile
        : storedFile
          ? URL.createObjectURL(storedFile)
          : document.dataUrl;
    if (!href) {
      setMessage('הקובץ אינו נמצא במכשיר זה. ניתן לערוך את המסמך ולהעלות אותו מחדש.');
      return;
    }
    const link = window.document.createElement('a');
    link.href = href;
    link.download = document.fileName || document.name;
    link.target = '_blank';
    link.rel = 'noopener';
    link.click();
    if (storedFile instanceof Blob) window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
  }

  async function removeDocument(document: MvpDocument) {
    if (!window.confirm(`למחוק את "${document.name}"?`)) return;
    await deleteDocumentFile(document.id);
    persist(documents.filter((item) => item.id !== document.id));
    setMessage('המסמך נמחק.');
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">מרכז מסמכים</p>
          <h1>כל המסמכים במקום אחד</h1>
          <p>הוספה, פתיחה, עדכון ומעקב אחר מסמכים שנשמרו במערכת.</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setShowForm(true)}>
          ↑ הוספת מסמך
        </button>
      </header>

      {message ? (
        <p className="info-box" role="status">
          {message}
        </p>
      ) : null}

      {/* Honest data-source labelling — see the matching comment in TasksPage.tsx §2. */}
      {syncStatus.phase === 'uploading' ? (
        <p className="info-box" role="status">
          {t('documents.sync.uploading', {
            completed: syncStatus.completed,
            total: syncStatus.total,
          })}
        </p>
      ) : syncStatus.phase === 'offline' ? (
        <p className="info-box" role="status">
          {t('documents.sync.localCopy')}
        </p>
      ) : syncStatus.phase === 'ambiguous' ? (
        <p className="action-notice error" role="alert">
          {t('documents.sync.ambiguous')}
        </p>
      ) : syncStatus.phase === 'upload-failed' ? (
        <p className="action-notice error" role="alert">
          {t('documents.sync.uploadFailed', { count: syncStatus.failedCount })}{' '}
          <button
            className="text-link"
            type="button"
            onClick={() => setSyncAttempt((count) => count + 1)}
          >
            {t('documents.sync.retry')}
          </button>
        </p>
      ) : null}

      {showForm ? (
        <form
          className="card readable-form document-editor"
          onSubmit={(event) => void saveDocument(event)}
        >
          <div className="section-heading">
            <h2>{editingId ? 'עריכת מסמך' : 'הוספת מסמך'}</h2>
            <button className="text-link" type="button" onClick={resetForm}>
              סגירה
            </button>
          </div>
          <div className="form-grid">
            <label>
              שם המסמך
              <input
                required
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label>
              סוג
              <select
                value={draft.category}
                onChange={(event) => setDraft({ ...draft, category: event.target.value })}
              >
                {[
                  'דרכון',
                  'אשרת עבודה',
                  'ביטוח רפואי',
                  'חוזה העסקה',
                  'אישור בנק',
                  'תלוש שכר',
                  'מסמך אחר',
                ].map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </label>
            <label>
              תוקף המסמך
              <input
                required
                type="date"
                className="document-date-input"
                lang="he"
                dir="ltr"
                value={draft.dateLabel}
                aria-label="תוקף המסמך"
                aria-describedby="document-expiry-help"
                onChange={(event) => setDraft({ ...draft, dateLabel: event.target.value })}
              />
              <small id="document-expiry-help">לחצו על סמל לוח השנה לבחירת תאריך.</small>
            </label>
            <label>
              מצב
              <select
                value={draft.status}
                onChange={(event) =>
                  setDraft({ ...draft, status: event.target.value as MvpDocumentStatus })
                }
              >
                <option value="valid">תקין</option>
                <option value="attention">דורש טיפול</option>
              </select>
            </label>
            <label>
              {editingId ? 'החלפת קובץ (לא חובה)' : 'בחירת קובץ'}
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <p className="form-note">
            {auth.enabled
              ? 'PDF, JPG או PNG עד 5MB. הקובץ נשמר באחסון פרטי ומוצפן ונפתח באמצעות קישור זמני בלבד.'
              : 'PDF, JPG או PNG עד 5MB. בסביבה המקומית הקובץ נשמר רק במכשיר הנוכחי.'}
          </p>
          <button className="primary-button" type="submit">
            שמירת המסמך
          </button>
        </form>
      ) : null}

      {documents.length === 0 ? (
        <section className="card empty-panel">
          <h2>עדיין לא נוספו מסמכים</h2>
          <p>המסך אינו מציג עוד מסמכי הדגמה. לחצו על “הוספת מסמך” כדי להתחיל.</p>
        </section>
      ) : (
        <>
          {/* The validity label and the status pill repeat what was entered on the
              upload form; nothing here is verified against an outside register. */}
          <p className="legal-note" id="documents-liability-note">
            {t('liability.data')}
          </p>
          <section className="document-grid" aria-describedby="documents-liability-note">
            {documents.map((document) => {
              const display = documentDisplayStatus(document);
              const badgeLabel =
                display.status === 'attention'
                  ? display.classification === 'expired'
                    ? 'פג תוקף'
                    : 'דורש טיפול'
                  : 'תקין';
              return (
                <article className="document-card" key={document.id}>
                  <div className="doc-icon" aria-hidden="true">
                    ▤
                  </div>
                  <div>
                    <h3>{document.name}</h3>
                    <p>
                      {document.category} · {document.dateLabel}
                    </p>
                    <small>{document.fileName}</small>
                  </div>
                  <span className={`pill ${display.status === 'attention' ? 'amber' : 'green'}`}>
                    {badgeLabel}
                  </span>
                  <div className="document-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void openDocument(document)}
                    >
                      פתיחה
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => startEdit(document)}
                    >
                      עריכה
                    </button>
                    <button
                      className="danger-button"
                      type="button"
                      onClick={() => void removeDocument(document)}
                    >
                      מחיקה
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}

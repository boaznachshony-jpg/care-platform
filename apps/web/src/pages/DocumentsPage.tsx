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
import { useAuth } from '../auth/auth-context.js';
import { importCaseDocument, listCaseDocuments } from '../api/client.js';
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
  isAllowedDocumentMediaType,
  localCategoryToDocumentType,
  parseDataUrl,
} from '../sync/document-mapping.js';

const MAX_FILE_SIZE = 10_000_000;
const ALLOWED_FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

const toDateInputValue = dateLabelToIsoDate;

function formatExpiryDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `בתוקף עד ${day}.${month}.${year}`;
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

  const legacyClientId = useLegacyClientId();
  const caseLookup = useCaseForLegacyClient(legacyClientId);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ phase: 'checking' });
  const [syncAttempt, setSyncAttempt] = useState(0);

  useEffect(() => {
    if (caseLookup.status !== 'found') {
      setSyncStatus(
        caseLookup.status === 'checking' ? { phase: 'checking' } : { phase: 'no-case' },
      );
      return;
    }
    const caseId = caseLookup.caseId;
    let active = true;

    async function run() {
      // Only records with an inline `dataUrl` carry a file at all — see the
      // long comment on parseDataUrl in sync/document-mapping.ts for why the
      // separate device file cache (document-file-store.ts) is out of scope
      // here. Every other local record uploads as metadata only, which the
      // import endpoint explicitly supports (no version, same as a document
      // nobody has attached a file to yet).
      const localNow = readMvpDocuments();
      const outcome = await uploadUnsyncedRecords(
        'documents',
        caseId,
        localNow,
        (localDocument) => {
          const parsedFile = localDocument.dataUrl ? parseDataUrl(localDocument.dataUrl) : null;
          const importFile =
            parsedFile && isAllowedDocumentMediaType(parsedFile.mediaType)
              ? { mediaType: parsedFile.mediaType, content: parsedFile.content }
              : undefined;
          return importCaseDocument(caseId, {
            legacyLocalId: localDocument.id,
            documentType: localCategoryToDocumentType(localDocument.category),
            sensitivity: 'identity_sensitive',
            file: importFile,
            expiresOn: dateLabelToIsoDate(localDocument.dateLabel) || undefined,
          });
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
        const byLocalId = new Map(
          serverDocuments
            .filter((document) => document.legacyLocalId)
            .map((document) => [document.legacyLocalId as string, document] as const),
        );
        const merged = readMvpDocuments().map((document) => {
          const match = byLocalId.get(document.id);
          // The server response never carries the file bytes or name back
          // (Constitution §16), so an already-known local record keeps its
          // own fileName/fileType/dataUrl — only the fields the server can
          // actually confirm (category/date/status) are refreshed.
          return match
            ? {
                ...document,
                ...documentResponseToLocal(match),
                fileName: document.fileName,
                fileType: document.fileType,
              }
            : document;
        });
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
  }, [caseLookup, syncAttempt]);

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
        setMessage('הקובץ גדול מדי. ניתן להעלות PDF או תמונה עד 10MB.');
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
      {syncStatus.phase === 'offline' ? (
        <p className="info-box" role="status">
          {t('documents.sync.localCopy')}
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
              ? 'PDF, JPG או PNG עד 10MB. הקובץ נשמר באחסון פרטי ומוצפן ונפתח באמצעות קישור זמני בלבד.'
              : 'PDF, JPG או PNG עד 10MB. בסביבה המקומית הקובץ נשמר רק במכשיר הנוכחי.'}
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
            {documents.map((document) => (
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
                <span className={`pill ${document.status === 'attention' ? 'amber' : 'green'}`}>
                  {document.status === 'attention' ? 'דורש טיפול' : 'תקין'}
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
            ))}
          </section>
        </>
      )}
    </div>
  );
}

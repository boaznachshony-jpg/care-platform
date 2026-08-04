/* eslint-disable no-restricted-syntax */
import { useRef, useState } from 'react';
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

const MAX_FILE_SIZE = 10_000_000;
const ALLOWED_FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

function toDateInputValue(dateLabel: string): string {
  const isoMatch = dateLabel.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const displayMatch = dateLabel.match(/\b(\d{2})[./](\d{2})[./](\d{4})\b/);
  if (displayMatch) return `${displayMatch[3]}-${displayMatch[2]}-${displayMatch[1]}`;

  return '';
}

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
  const auth = useAuth();
  const [documents, setDocuments] = useState(readMvpDocuments);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  function persist(next: MvpDocument[]) {
    saveMvpDocuments(next);
    setDocuments(next);
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
          <p>הוספה, פתיחה, עדכון ומעקב אחר מסמכים שנשמרו במכשיר זה.</p>
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
        <section className="document-grid">
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
      )}
    </div>
  );
}

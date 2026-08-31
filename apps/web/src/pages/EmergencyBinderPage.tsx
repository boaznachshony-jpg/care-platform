/* eslint-disable no-restricted-syntax -- Hebrew-first reviewed export surface */
import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type {
  CaseContactResponse,
  DocumentResponse,
  EmploymentCaseResponse,
  TaskResponse,
} from '@caredesk/schemas';
import {
  createBinderExport,
  listCanonicalPayrollCloses,
  listCaseContacts,
  listCaseDocuments,
  listCaseTasks,
  listEmploymentCases,
  type BinderExportReceiptResponse,
  type CanonicalPayrollClose,
} from '../api/client.js';
import { useClientPath } from '../hooks/use-client-path.js';
import { useLegacyClientId } from '../hooks/use-legacy-client-id.js';
import { formatDateOnly, formatDateTime, toIsoAttribute } from '../format-timestamp.js';
import { readMvpMedications, type MvpMedication } from '../storage/mvp-storage.js';

const presets = {
  full: ['case', 'caregiver', 'medications', 'documents', 'payroll', 'tasks', 'contacts'],
  review: ['case', 'caregiver', 'documents', 'payroll'],
  // A handover is the case this binder exists for, so the standing
  // medications belong in it before anything administrative does.
  handoff: ['case', 'caregiver', 'medications', 'tasks', 'contacts'],
  documents: ['documents'],
} as const;
type Section = (typeof presets.full)[number];
const labels: Record<Section, string> = {
  case: 'סיכום המטופל ותיק ההעסקה',
  caregiver: 'סיכום המטפל/ת',
  medications: 'תרופות קבועות',
  documents: 'מסמכים שנבחרו',
  payroll: 'היסטוריית תשלומים סגורה',
  tasks: 'משימות פעילות',
  contacts: 'אנשי קשר חשובים',
};

interface BinderData {
  employmentCase: EmploymentCaseResponse;
  documents: DocumentResponse[];
  payroll: CanonicalPayrollClose[];
  tasks: TaskResponse[];
  contacts: CaseContactResponse[];
}

/**
 * crypto.randomUUID only exists in secure contexts, and this app is
 * deliberately reachable over plain http on a phone at 192.168.x.x — so a
 * non-cryptographic fallback keeps the export recordable there too. The key
 * only de-duplicates retries; uniqueness, not secrecy, is what it needs.
 */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `binder-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export function EmergencyBinderPage() {
  const { t } = useTranslation();
  const openCasePath = useClientPath()('/cases/new');
  const legacyClientId = useLegacyClientId();
  const [cases, setCases] = useState<EmploymentCaseResponse[]>([]);
  const [caseId, setCaseId] = useState('');
  const [data, setData] = useState<BinderData>();
  const [state, setState] = useState<'loading' | 'select' | 'loading-case' | 'ready' | 'error'>(
    'loading',
  );
  const [selected, setSelected] = useState<Section[]>([...presets.full]);
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  // Server-side export receipt ("אסמכתת ייצוא"): 'recorded' means the export
  // was persisted with an immutable receipt before printing; 'unrecorded'
  // means the server could not be reached and the print stays a local,
  // explicitly labelled, unrecorded copy.
  const [exportState, setExportState] = useState<'idle' | 'recording' | 'recorded' | 'unrecorded'>(
    'idle',
  );
  const [receipt, setReceipt] = useState<BinderExportReceiptResponse>();
  // Medications live in the client's own local record rather than on the
  // server, so they are read directly instead of arriving with the case.
  const [medications] = useState<MvpMedication[]>(() => readMvpMedications());
  const generatedAt = useMemo(
    () =>
      new Intl.DateTimeFormat('he-IL', { dateStyle: 'long', timeStyle: 'short' }).format(
        new Date(),
      ),
    [],
  );

  useEffect(() => {
    let active = true;
    listEmploymentCases()
      .then((rows) => {
        if (!active) return;
        setCases(rows);
        // Preselect the case belonging to the client whose binder this is
        // (`employment_case.legacy_client_id`, migration 0042). The binder is in
        // the mobile nav ("תיק חירום"), so a customer who has just finished
        // setup lands on their own case instead of an empty picker.
        //
        // Only an explicit link preselects. A case that predates 0042 carries
        // `legacyClientId: null` and is left for the user to choose, exactly as
        // before - guessing on their behalf is how the wrong household ends up
        // in an emergency binder.
        const linked = rows.find((row) => row.legacyClientId === legacyClientId);
        if (linked) setCaseId(linked.id);
        setState('select');
      })
      .catch(() => active && setState('error'));
    return () => {
      active = false;
    };
  }, [legacyClientId]);

  useEffect(() => {
    setReceipt(undefined);
    setExportState('idle');
    if (!caseId) {
      setData(undefined);
      setDocumentIds([]);
      return;
    }
    let active = true;
    const employmentCase = cases.find((row) => row.id === caseId);
    if (!employmentCase) return;
    setState('loading-case');
    setDocumentIds([]);
    Promise.all([
      listCaseDocuments(caseId),
      listCanonicalPayrollCloses(caseId),
      listCaseTasks(caseId),
      listCaseContacts(caseId),
    ])
      .then(([documents, payroll, tasks, contacts]) => {
        if (!active) return;
        setData({ employmentCase, documents, payroll, tasks, contacts });
        setState('ready');
      })
      .catch(() => active && setState('error'));
    return () => {
      active = false;
    };
  }, [caseId, cases]);

  const toggle = (section: Section) =>
    setSelected((current) =>
      current.includes(section)
        ? current.filter((item) => item !== section)
        : [...current, section],
    );
  const openTasks = data?.tasks.filter((task) => task.status !== 'completed') ?? [];

  /**
   * Records the export server-side (immutable receipt + hash) before opening
   * the print dialog. If the server cannot be reached the print still works,
   * but is explicitly labelled — on screen and on paper — as an unrecorded
   * local print. flushSync makes the receipt/label reach the DOM before the
   * synchronous, render-blocking window.print().
   */
  const exportBinder = async () => {
    if (!data || !selected.length || exportState === 'recording') return;
    setExportState('recording');
    const manifest = {
      // Canonical order so the same explicit selection always hashes the same.
      sections: presets.full.filter((section) => selected.includes(section)),
      documentIds: selected.includes('documents') ? [...documentIds].sort() : [],
    };
    try {
      const result = await createBinderExport(caseId, manifest, newIdempotencyKey());
      flushSync(() => {
        setReceipt(result.receipt);
        setExportState('recorded');
      });
    } catch {
      flushSync(() => {
        setReceipt(undefined);
        setExportState('unrecorded');
      });
    }
    window.print();
  };

  return (
    <div className="binder-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">תיק חירום</p>
          <h1>הורדת תיק העסקה</h1>
          <p>המידע נטען מתיק ההעסקה המאומת. בחרו במפורש תיק וסעיפים לפני הייצוא.</p>
        </div>
      </header>
      <section className="card binder-controls no-print" aria-labelledby="binder-review-title">
        <h2 id="binder-review-title">מה לכלול בתיק?</h2>
        <label>
          תיק העסקה
          <select value={caseId} onChange={(event) => setCaseId(event.target.value)}>
            <option value="">בחרו תיק</option>
            {cases.map((row) => (
              <option key={row.id} value={row.id}>
                {row.careRecipient.fullName} —{' '}
                {row.caregiver.preferredName ?? row.caregiver.legalName}
              </option>
            ))}
          </select>
        </label>
        {caseId ? (
          // The canonical case screen used to be reachable only by pasting a
          // UUID into the address bar (WEB-11). This is the link.
          <p>
            <Link to={`/cases/${encodeURIComponent(caseId)}`}>מעבר לתיק ההעסקה המלא</Link>
          </p>
        ) : null}
        {state === 'loading' || state === 'loading-case' ? <p role="status">טוען מידע…</p> : null}
        {state === 'error' ? <p role="alert">לא ניתן לטעון את התיק. נסו שוב.</p> : null}
        {state === 'select' && cases.length === 0 ? (
          // Was a bare "לא נמצא תיק העסקה פעיל." shown to every real user,
          // because nothing in the product created a case (WEB-11). Now that
          // case creation is reachable, the empty state says what to do about
          // it instead of being a dead end on a headline feature.
          <p>
            לא נמצא תיק העסקה פעיל. <Link to={openCasePath}>פתיחת תיק העסקה</Link>
          </p>
        ) : null}
        <label>
          סוג תיק
          <select
            onChange={(event) =>
              setSelected([...presets[event.target.value as keyof typeof presets]])
            }
            defaultValue="full"
          >
            <option value="full">תיק העסקה מלא</option>
            <option value="review">חבילת בדיקה מקצועית</option>
            <option value="handoff">העברה משפחתית בחירום</option>
            <option value="documents">מסמכים בלבד</option>
          </select>
        </label>
        <fieldset disabled={!data}>
          <legend>סעיפים</legend>
          {(Object.keys(labels) as Section[]).map((section) => (
            <label key={section}>
              <input
                type="checkbox"
                checked={selected.includes(section)}
                onChange={() => toggle(section)}
              />{' '}
              {labels[section]}{' '}
              {section === 'payroll' ? (
                <strong className="sensitive-label">מידע רגיש</strong>
              ) : null}
            </label>
          ))}
        </fieldset>
        {data && selected.includes('documents') ? (
          <fieldset>
            <legend>מסמכים — לא נבחרים אוטומטית</legend>
            {data.documents.length ? (
              data.documents.map((document) => (
                <label key={document.id}>
                  <input
                    type="checkbox"
                    checked={documentIds.includes(document.id)}
                    onChange={() =>
                      setDocumentIds((current) =>
                        current.includes(document.id)
                          ? current.filter((id) => id !== document.id)
                          : [...current, document.id],
                      )
                    }
                  />{' '}
                  {document.documentType} ({document.verificationStatus ?? document.status})
                </label>
              ))
            ) : (
              <p>לא נשמרו מסמכים.</p>
            )}
          </fieldset>
        ) : null}
        <button
          className="primary-button"
          type="button"
          disabled={!data || !selected.length || exportState === 'recording'}
          onClick={() => void exportBinder()}
        >
          יצירת PDF / הדפסה
        </button>
        {exportState === 'recording' ? <p role="status">{t('binder.recordingExport')}</p> : null}
        {exportState === 'recorded' && receipt ? (
          <p role="status">
            {t('binder.receiptLabel')}: <code>{receipt.id}</code> · {t('binder.receiptHash')}:{' '}
            <code>{receipt.contentHash}</code>
          </p>
        ) : null}
        {exportState === 'unrecorded' ? (
          <p role="alert">{t('binder.unrecordedLocalPrint')}</p>
        ) : null}
        <p>
          <small>קובץ ההדפסה נוצר במכשיר ואינו קישור ציבורי. בדקו הרשאות שיתוף לפני העברה.</small>
        </p>
      </section>
      {data ? (
        <article className="card binder-document" dir="rtl">
          <header>
            <strong>CareDesk — תיק העסקה</strong>
            <h2>{data.employmentCase.careRecipient.fullName}</h2>
            <p>נוצר: {generatedAt}</p>
            {exportState === 'recorded' && receipt ? (
              <p className="binder-receipt">
                {t('binder.receiptLabel')}: {receipt.id} · {t('binder.receiptHash')}:{' '}
                {receipt.contentHash}
              </p>
            ) : null}
            {exportState === 'unrecorded' ? (
              <p className="binder-receipt">{t('binder.unrecordedLocalPrint')}</p>
            ) : null}
          </header>
          <nav aria-label="תוכן עניינים">
            <h3>תוכן עניינים</h3>
            <ol>
              {selected.map((section) => (
                <li key={section}>
                  <a href={`#binder-${section}`}>{labels[section]}</a>
                </li>
              ))}
            </ol>
          </nav>
          {selected.includes('case') && (
            <section id="binder-case">
              <h3>{labels.case}</h3>
              <dl>
                <dt>מטופל/ת</dt>
                <dd>{data.employmentCase.careRecipient.fullName}</dd>
                <dt>מעסיק/ה</dt>
                <dd>{data.employmentCase.employer.fullName}</dd>
                <dt>תחילת העסקה</dt>
                <dd>{data.employmentCase.startDate}</dd>
              </dl>
            </section>
          )}
          {selected.includes('caregiver') && (
            <section id="binder-caregiver">
              <h3>{labels.caregiver}</h3>
              <p>
                {data.employmentCase.caregiver.preferredName ??
                  data.employmentCase.caregiver.legalName}{' '}
                · {data.employmentCase.caregiver.nationality}
              </p>
            </section>
          )}
          {selected.includes('contacts') && (
            <section id="binder-contacts">
              <h3>{labels.contacts}</h3>
              {data.contacts.length ? (
                <ul>
                  {data.contacts.map((contact) => (
                    <li key={contact.roleId}>
                      {contact.fullName} — {contact.roleType}
                      {contact.isEmergency ? ' (חירום)' : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>אנשי קשר לא הוגדרו.</p>
              )}
            </section>
          )}
          {selected.includes('medications') && (
            <section id="binder-medications">
              <h3>{labels.medications}</h3>
              {medications.length ? (
                <>
                  <table>
                    <thead>
                      <tr>
                        <th>תרופה</th>
                        <th>מינון</th>
                        <th>מתי</th>
                        <th>רופא/ה ממליץ/ה</th>
                      </tr>
                    </thead>
                    <tbody>
                      {medications.map((medication) => (
                        <tr key={medication.id}>
                          <td>{medication.name}</td>
                          <td>{medication.dosage || '—'}</td>
                          <td>
                            {medication.daily ? 'כל יום' : 'לא כל יום'}
                            {medication.timesOfDay.length
                              ? ` · ${medication.timesOfDay
                                  .map(
                                    (time) =>
                                      ({
                                        morning: 'בוקר',
                                        noon: 'צהריים',
                                        evening: 'ערב',
                                        night: 'לילה',
                                      })[time],
                                  )
                                  .join(', ')}`
                              : ' · לפי הצורך'}
                          </td>
                          <td>{medication.prescribingDoctor || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="report-footnote">
                    <span aria-hidden="true">*</span> הרישום מבוסס על המידע שמסר הלקוח ואינו המלצה
                    רפואית או מרשם.
                  </p>
                </>
              ) : (
                <p>לא נרשמו תרופות קבועות.</p>
              )}
            </section>
          )}
          {selected.includes('payroll') && (
            <section id="binder-payroll">
              <h3>{labels.payroll}</h3>
              {data.payroll.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>חודש</th>
                      <th>סכום</th>
                      <th>תאריך תשלום</th>
                      <th>נסגר בתאריך ובשעה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payroll.map((record) => (
                      <tr key={record.id}>
                        <td>{record.month}</td>
                        <td>
                          {record.total === null
                            ? 'לא ידוע'
                            : `₪${record.total.toLocaleString('he-IL')}`}
                        </td>
                        <td>
                          {toIsoAttribute(record.paymentDate) ? (
                            <time dateTime={toIsoAttribute(record.paymentDate) ?? undefined}>
                              {formatDateOnly(record.paymentDate)}
                            </time>
                          ) : (
                            'לא ידוע'
                          )}
                        </td>
                        <td>
                          {toIsoAttribute(record.closedAt) ? (
                            <time dateTime={toIsoAttribute(record.closedAt) ?? undefined}>
                              {formatDateTime(record.closedAt)}
                            </time>
                          ) : (
                            'לא ידוע'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>אין חודשי שכר סגורים.</p>
              )}
            </section>
          )}
          {selected.includes('tasks') && (
            <section id="binder-tasks">
              <h3>{labels.tasks}</h3>
              {openTasks.length ? (
                <ul>
                  {openTasks.map((task) => (
                    <li key={task.id}>
                      {task.title ?? task.titleKey ?? 'משימה'}
                      {task.dueAt ? ` — ${task.dueAt.slice(0, 10)}` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>אין משימות פעילות.</p>
              )}
            </section>
          )}
          {selected.includes('documents') && (
            <section id="binder-documents">
              <h3>{labels.documents}</h3>
              {documentIds.length ? (
                <ul>
                  {data.documents
                    .filter((document) => documentIds.includes(document.id))
                    .map((document) => (
                      <li key={document.id}>
                        {document.documentType} — {document.verificationStatus ?? document.status}
                      </li>
                    ))}
                </ul>
              ) : (
                <p>לא נבחרו מסמכים. הייצוא מציג מטא־נתונים בלבד ואינו מטמיע קבצים.</p>
              )}
            </section>
          )}
        </article>
      ) : null}
    </div>
  );
}

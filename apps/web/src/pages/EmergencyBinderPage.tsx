/* eslint-disable no-restricted-syntax -- Hebrew-first reviewed export surface */
import { useEffect, useMemo, useState } from 'react';
import type {
  CaseContactResponse,
  DocumentResponse,
  EmploymentCaseResponse,
  TaskResponse,
} from '@caredesk/schemas';
import {
  listCanonicalPayrollCloses,
  listCaseContacts,
  listCaseDocuments,
  listCaseTasks,
  listEmploymentCases,
  type CanonicalPayrollClose,
} from '../api/client.js';

const presets = {
  full: ['case', 'caregiver', 'documents', 'payroll', 'tasks', 'contacts'],
  review: ['case', 'caregiver', 'documents', 'payroll'],
  handoff: ['case', 'caregiver', 'tasks', 'contacts'],
  documents: ['documents'],
} as const;
type Section = (typeof presets.full)[number];
const labels: Record<Section, string> = {
  case: 'סיכום המטופל ותיק ההעסקה',
  caregiver: 'סיכום המטפל/ת',
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

export function EmergencyBinderPage() {
  const [cases, setCases] = useState<EmploymentCaseResponse[]>([]);
  const [caseId, setCaseId] = useState('');
  const [data, setData] = useState<BinderData>();
  const [state, setState] = useState<'loading' | 'select' | 'loading-case' | 'ready' | 'error'>(
    'loading',
  );
  const [selected, setSelected] = useState<Section[]>([...presets.full]);
  const [documentIds, setDocumentIds] = useState<string[]>([]);
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
        setState('select');
      })
      .catch(() => active && setState('error'));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
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
        {state === 'loading' || state === 'loading-case' ? <p role="status">טוען מידע…</p> : null}
        {state === 'error' ? <p role="alert">לא ניתן לטעון את התיק. נסו שוב.</p> : null}
        {state === 'select' && cases.length === 0 ? <p>לא נמצא תיק העסקה פעיל.</p> : null}
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
          disabled={!data || !selected.length}
          onClick={() => window.print()}
        >
          יצירת PDF / הדפסה
        </button>
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
          {selected.includes('payroll') && (
            <section id="binder-payroll">
              <h3>{labels.payroll}</h3>
              {data.payroll.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>חודש</th>
                      <th>סכום</th>
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

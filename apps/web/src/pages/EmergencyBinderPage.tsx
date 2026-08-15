/* eslint-disable no-restricted-syntax -- Hebrew-first MVP surface */
import { useMemo, useState } from 'react';
import { useMvpProfile } from '../hooks/use-mvp-profile.js';
import { readMvpDocuments, readMvpPayroll, readMvpTasks } from '../storage/mvp-storage.js';

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
  payroll: 'היסטוריית תשלומים',
  tasks: 'משימות פעילות',
  contacts: 'אנשי קשר חשובים',
};

export function EmergencyBinderPage() {
  const [profile] = useMvpProfile();
  const documents = readMvpDocuments();
  const payroll = readMvpPayroll();
  const tasks = readMvpTasks();
  const [selected, setSelected] = useState<Section[]>([...presets.full]);
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const generatedAt = useMemo(
    () =>
      new Intl.DateTimeFormat('he-IL', { dateStyle: 'long', timeStyle: 'short' }).format(
        new Date(),
      ),
    [],
  );
  const toggle = (section: Section) =>
    setSelected((current) =>
      current.includes(section)
        ? current.filter((item) => item !== section)
        : [...current, section],
    );
  return (
    <div className="binder-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">תיק חירום</p>
          <h1>הורדת תיק העסקה</h1>
          <p>בחרו במפורש מה לכלול. המסמך נוצר במכשיר שלכם ואינו קישור ציבורי.</p>
        </div>
      </header>
      <section className="card binder-controls no-print" aria-labelledby="binder-review-title">
        <h2 id="binder-review-title">מה לכלול בתיק?</h2>
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
        <fieldset>
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
        {selected.includes('documents') ? (
          <fieldset>
            <legend>מסמכים — לא נבחרים אוטומטית</legend>
            {documents.length ? (
              documents.map((document) => (
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
                  {document.name || document.fileName}
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
          disabled={!selected.length}
          onClick={() => window.print()}
        >
          יצירת PDF / הדפסה
        </button>
        <p>
          <small>
            בדקו את תצוגת ההדפסה ובחרו “שמירה כ‑PDF”. מידע חסר מסומן במפורש. אין לכלול קובץ שלא
            הוסמך לשיתוף.
          </small>
        </p>
      </section>
      <article className="card binder-document" dir="rtl">
        <header>
          <strong>CareDesk — תיק העסקה</strong>
          <h2>{profile.recipientName || 'זהות התיק אינה ידועה'}</h2>
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
              <dd>{profile.recipientName || 'לא ידוע'}</dd>
              <dt>מעסיק/ה</dt>
              <dd>{profile.employerName || 'לא ידוע'}</dd>
              <dt>תחילת העסקה</dt>
              <dd>{profile.employmentStartDate || 'לא ידוע'}</dd>
            </dl>
          </section>
        )}
        {selected.includes('caregiver') && (
          <section id="binder-caregiver">
            <h3>{labels.caregiver}</h3>
            <p>
              {profile.caregiverName || 'שם המטפל/ת אינו ידוע'} ·{' '}
              {profile.caregiverCountry || 'מדינת מוצא לא ידועה'}
            </p>
          </section>
        )}
        {selected.includes('contacts') && (
          <section id="binder-contacts">
            <h3>{labels.contacts}</h3>
            <p>
              {profile.representativeName || 'איש קשר לא הוגדר'}{' '}
              {profile.representativePhone ? `· ${profile.representativePhone}` : ''}
            </p>
          </section>
        )}
        {selected.includes('payroll') && (
          <section id="binder-payroll">
            <h3>{labels.payroll}</h3>
            {payroll.length ? (
              <table>
                <thead>
                  <tr>
                    <th>חודש</th>
                    <th>סכום</th>
                  </tr>
                </thead>
                <tbody>
                  {payroll.map((record) => (
                    <tr key={record.id}>
                      <td>{record.month}</td>
                      <td>₪{record.total.toLocaleString('he-IL')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>אין נתוני תשלום.</p>
            )}
          </section>
        )}
        {selected.includes('tasks') && (
          <section id="binder-tasks">
            <h3>{labels.tasks}</h3>
            {tasks.filter((task) => task.status === 'open').length ? (
              <ul>
                {tasks
                  .filter((task) => task.status === 'open')
                  .map((task) => (
                    <li key={task.id}>
                      {task.title} — {task.dueDate}
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
                {documents
                  .filter((document) => documentIds.includes(document.id))
                  .map((document) => (
                    <li key={document.id}>
                      {document.name || document.fileName} — {document.category} ({document.status})
                    </li>
                  ))}
              </ul>
            ) : (
              <p>לא נבחרו מסמכים. קבצים אינם מוטמעים כ‑HTML; האינדקס מציג מטא־נתונים בלבד.</p>
            )}
          </section>
        )}
      </article>
    </div>
  );
}

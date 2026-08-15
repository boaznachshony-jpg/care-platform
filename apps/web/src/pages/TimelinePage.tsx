/* eslint-disable no-restricted-syntax -- legacy MVP Hebrew-first surface; localization extraction is tracked */
import { Link } from 'react-router-dom';
import { useClientPath } from '../hooks/use-client-path.js';
import { useMvpProfile } from '../hooks/use-mvp-profile.js';
import {
  clientIdFromPath,
  readMvpDocuments,
  readMvpMonthlyCloses,
  readMvpPayroll,
  readMvpTasks,
} from '../storage/mvp-storage.js';
import { productIntelligence } from '../product-intelligence.js';

const labels = {
  overdue: 'באיחור',
  today: 'היום',
  this_week: 'השבוע',
  later_this_month: 'בהמשך החודש',
  upcoming: 'בהמשך',
} as const;

export function TimelinePage({ today }: { today?: Date; employmentStartDate?: string } = {}) {
  const path = useClientPath();
  const [profile] = useMvpProfile();
  const projection = productIntelligence({
    clientId: clientIdFromPath() ?? 'legacy',
    today: (today ?? new Date()).toISOString().slice(0, 10),
    profile,
    tasks: readMvpTasks(),
    documents: readMvpDocuments(),
    payroll: readMvpPayroll(),
    closes: readMvpMonthlyCloses(),
  }).timeline;
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">ציר זמן ציות</p>
          <h1>מה צפוי בתיק</h1>
          <p>
            מועדים שנגזרו רק ממשימות ומנתונים שנשמרו בתיק. אין כאן מועדים משפטיים שהמערכת המציאה.
          </p>
        </div>
      </header>
      {projection.length === 0 ? (
        <p className="success-box">אין כרגע מועדים פתוחים להצגה.</p>
      ) : (
        (Object.keys(labels) as (keyof typeof labels)[]).map((group) => {
          const items = projection.filter((item) => item.group === group);
          return items.length ? (
            <section className="card" key={group} aria-labelledby={`timeline-${group}`}>
              <h2 id={`timeline-${group}`}>{labels[group]}</h2>
              <div className="timeline">
                {items.map((item) => (
                  <article key={item.id}>
                    <time className="timeline-date" dateTime={item.dueDate}>
                      {item.dueDate}
                    </time>
                    <span className={`timeline-dot ${item.severity}`} aria-hidden="true" />
                    <div className="timeline-content">
                      <h3>{item.title}</h3>
                      <p>{item.reason}</p>
                      <small>
                        מקור: {item.sourceType} · {item.provenance.sourceId}
                      </small>
                      {item.actionTarget ? (
                        <Link to={path(item.actionTarget)}>פתיחת הפעולה</Link>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null;
        })
      )}
    </div>
  );
}

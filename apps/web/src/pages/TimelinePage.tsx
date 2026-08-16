/* eslint-disable no-restricted-syntax -- Hebrew-first canonical timeline surface */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { useClientPath } from '../hooks/use-client-path.js';
import { listCaseTimeline, type CanonicalTimelineEvent } from '../api/client.js';

export function TimelinePage() {
  const path = useClientPath();
  const { clientId } = useParams<{ clientId: string }>();
  const [events, setEvents] = useState<CanonicalTimelineEvent[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!clientId) {
      setFailed(true);
      return;
    }
    listCaseTimeline(clientId)
      .then(setEvents)
      .catch(() => setFailed(true));
  }, [clientId]);
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">ציר זמן ציות</p>
          <h1>מה קרה בתיק</h1>
          <p>אירועים אנושיים מהתיק הקנוני; פרטי אבטחה וספקים נשמרים בנפרד ביומן הביקורת.</p>
        </div>
      </header>
      {failed ? (
        <p role="alert">לא ניתן לטעון את ציר הזמן הקנוני.</p>
      ) : events === undefined ? (
        <p>טוען…</p>
      ) : events.length === 0 ? (
        <p className="success-box">אין כרגע אירועים להצגה.</p>
      ) : (
        <section className="card" aria-label="ציר זמן קנוני">
          <div className="timeline">
            {events.map((event) => (
              <article key={event.id}>
                <time className="timeline-date" dateTime={event.occurredAt}>
                  {event.occurredAt.slice(0, 10)}
                </time>
                <span className="timeline-dot info" aria-hidden="true" />
                <div className="timeline-content">
                  <h3>{event.summaryKey}</h3>
                  <p>{event.eventTypeKey}</p>
                  {event.actorDisplay ? <small>{event.actorDisplay}</small> : null}
                  {event.actionTarget ? (
                    <Link to={path(event.actionTarget)}>פתיחת הפעולה</Link>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

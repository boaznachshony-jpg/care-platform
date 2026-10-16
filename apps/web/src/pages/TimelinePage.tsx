/* eslint-disable no-restricted-syntax -- Hebrew-first canonical timeline surface */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { formatDateTime, toIsoAttribute } from '../format-timestamp.js';
import { useClientPath } from '../hooks/use-client-path.js';
import { useLegacyClientId } from '../hooks/use-legacy-client-id.js';
import { useCaseForLegacyClient } from '../sync/use-case-for-legacy-client.js';
import { listCaseTimeline, type CanonicalTimelineEvent } from '../api/client.js';
import { UpcomingPaymentsCard } from '../components/UpcomingPaymentsCard.js';

export function TimelinePage() {
  const { t } = useTranslation();
  const path = useClientPath();
  // The timeline API is keyed by the canonical EMPLOYMENT CASE id, and the
  // route only ever gives a legacy CLIENT id. Passing the client id straight
  // through 404'd every request; there was a `.catch`, so the screen was not
  // silent, but it showed the generic "load failed" message forever, even for
  // normal navigation into a case with a real timeline. Resolve the canonical
  // case first, with the same hook already used for Tasks/Documents/
  // Medications, so the three outcomes below are told apart instead of all
  // collapsing into "failed".
  const legacyClientId = useLegacyClientId();
  const caseLookup = useCaseForLegacyClient(legacyClientId);
  const [events, setEvents] = useState<CanonicalTimelineEvent[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (caseLookup.status !== 'found') return;
    setFailed(false);
    setEvents(undefined);
    listCaseTimeline(caseLookup.caseId)
      .then(setEvents)
      .catch(() => setFailed(true));
  }, [caseLookup]);
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">ציר זמן ציות</p>
          <h1>מה קרה בתיק</h1>
          <p>אירועים אנושיים מהתיק הקנוני; פרטי אבטחה וספקים נשמרים בנפרד ביומן הביקורת.</p>
        </div>
      </header>
      <UpcomingPaymentsCard />
      {failed ? (
        <p role="alert">לא ניתן לטעון את ציר הזמן הקנוני.</p>
      ) : caseLookup.status === 'checking' ? (
        <p role="status">{t('shell.loading')}</p>
      ) : caseLookup.status === 'unavailable' ? (
        // Distinguish "the network failed while looking up the case" from
        // "this customer genuinely has no case yet" — the customer with no
        // case should not see a scary connectivity message, and the customer
        // whose lookup failed should not see the plain empty state.
        <p role="alert">לא ניתן להתחבר לשרת כדי לאתר את התיק כרגע. נסו שוב בעוד רגע.</p>
      ) : caseLookup.status === 'none' ? (
        <div className="card">
          <p className="success-box">עדיין לא נפתח תיק העסקה קנוני — ציר הזמן יופיע לאחר פתיחתו.</p>
          {/* The sentence names the missing step; the button is the step. */}
          <Link className="primary-button" to={path('/cases/new')}>
            {t('case.openTitle')}
          </Link>
        </div>
      ) : events === undefined ? (
        <p role="status">{t('shell.loading')}</p>
      ) : events.length === 0 ? (
        <p className="success-box">אין כרגע אירועים להצגה.</p>
      ) : (
        <section className="card" aria-label="ציר זמן קנוני">
          <div className="timeline">
            {events.map((event) => (
              <article key={event.id}>
                <time
                  className="timeline-date"
                  dateTime={toIsoAttribute(event.occurredAt) ?? event.occurredAt}
                >
                  {formatDateTime(event.occurredAt) ?? event.occurredAt}
                </time>
                <span className="timeline-dot info" aria-hidden="true" />
                <div className="timeline-content">
                  {/* summaryKey is a translation key (timeline.*.summary) for
                      events the API writes today, and plain English prose for
                      a few older ones. The default keeps the prose readable
                      instead of printing a dotted key as a heading. No
                      timeline.eventType.* namespace exists, so the machine
                      token is not shown at all. */}
                  <h3>{t(event.summaryKey, { defaultValue: event.summaryKey })}</h3>
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

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TimelineEventResponse } from '@caredesk/schemas';
import { EmptyState, Skeleton } from '@caredesk/ui';
import { listCaseTimeline } from '../../api/client.js';

/**
 * Timeline rows carry translation keys, never rendered text — the server
 * stores `timeline.task.created.summary`, and the locale decides the wording
 * (database-blueprint.md §4.10, Constitution §8).
 */
export function CaseTimelineSection({ caseId }: { caseId: string }) {
  const { t } = useTranslation();
  const [events, setEvents] = useState<TimelineEventResponse[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listCaseTimeline(caseId)
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  return (
    <section>
      <h2>{t('timeline.heading')}</h2>

      {events === null ? (
        <Skeleton loadingLabel={t('shell.loading')} height="1.5rem" width="14rem" />
      ) : events.length === 0 ? (
        <EmptyState title={t('timeline.empty')} body="" />
      ) : (
        <ol>
          {events.map((event) => (
            <li key={event.id}>
              <time dateTime={event.occurredAt} dir="ltr">
                {event.occurredAt.slice(0, 16).replace('T', ' ')}
              </time>{' '}
              {t(event.summaryKey)}
              {/* actorDisplay has always been on the payload. A timeline that
                  says what happened and when, but not who did it, cannot
                  answer the question people actually bring to it. */}
              {event.actorDisplay ? (
                <small className="record-timestamp">
                  {t('timeline.byActor')} {event.actorDisplay}
                </small>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

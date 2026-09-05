import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TimelineEventResponse } from '@caredesk/schemas';
import { EmptyState, ErrorState, Skeleton } from '@caredesk/ui';
import { listCaseTimeline } from '../../api/client.js';
import { formatDateTime, toIsoAttribute } from '../../format-timestamp.js';

/**
 * Timeline rows carry translation keys, never rendered text — the server
 * stores `timeline.task.created.summary`, and the locale decides the wording
 * (database-blueprint.md §4.10, Constitution §8).
 */
export function CaseTimelineSection({ caseId }: { caseId: string }) {
  const { t } = useTranslation();
  const [events, setEvents] = useState<TimelineEventResponse[] | null>(null);
  // A fetch that failed is not a case with no history. Kept apart from
  // `events` (which stays null) so the empty state never stands in for it.
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    listCaseTimeline(caseId)
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  return (
    <section>
      <h2>{t('timeline.heading')}</h2>

      {loadFailed ? (
        <ErrorState kind="retryable" title={t('timeline.loadFailed')} body="" />
      ) : events === null ? (
        <Skeleton loadingLabel={t('shell.loading')} height="1.5rem" width="14rem" />
      ) : events.length === 0 ? (
        <EmptyState title={t('timeline.empty')} body="" />
      ) : (
        <ol>
          {events.map((event) => (
            <li key={event.id}>
              {/* Israel wall clock, day-first — not the UTC "2026-08-14 22:30"
                  the stored ISO string reads as. See format-timestamp.ts. */}
              <time dateTime={toIsoAttribute(event.occurredAt) ?? event.occurredAt} dir="ltr">
                {formatDateTime(event.occurredAt) ?? event.occurredAt}
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

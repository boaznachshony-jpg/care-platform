/* eslint-disable no-restricted-syntax -- WEB defect 4(d): event-appropriate
   "no approved rule" wording is kept local rather than added to packages/i18n,
   which a concurrent agent owns; these strings should move there later. */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { confirmAssistantChecklist, newIdempotencyKey } from '../../api/client.js';

type View = 'home' | 'events' | 'travel' | 'plan' | 'assistant';
type EventType =
  | 'travel'
  | 'resigned'
  | 'termination'
  | 'hospitalized'
  | 'died'
  | 'institution'
  | 'notReturned'
  | 'replace';

// A same-day round trip is legitimate travel, so departure == return must be
// allowed; only departure AFTER return is a real ordering error.
function datesValid(departure: string, returnDate: string): boolean {
  return Boolean(departure && returnDate && returnDate >= departure);
}

// A trip recorded well after the fact is legitimate (Constitution §13: never
// block on a plausible late entry), but a departure date far in the past is
// unusual enough to deserve a non-blocking warning rather than silent
// acceptance.
const FAR_PAST_DAYS = 90;
function isFarPastDeparture(departure: string): boolean {
  if (!departure) return false;
  const departureMs = new Date(departure).getTime();
  if (Number.isNaN(departureMs)) return false;
  return Date.now() - departureMs > FAR_PAST_DAYS * 24 * 60 * 60 * 1000;
}

// The "no approved rule" wording used to be one sentence about a travel rule,
// reused verbatim for all eight event types — including "נפטר/ה" and
// "אושפז/ה", where talking about a missing "כלל נסיעה" (travel rule) makes no
// sense. Each event type gets wording that actually describes it; travel
// keeps the original text since it is genuinely about a travel rule.
const NO_APPROVED_RULE_TEXT: Record<EventType, string> = {
  travel: 'לא נמצא כלל נסיעה מאושר בתיק. אין אפשרות לקבוע בבטחה דרישות כניסה מחדש.',
  resigned: 'לא נמצא תהליך מאושר להתפטרות מטפל/ת בתיק. אין אפשרות לקבוע בבטחה את הצעדים הבאים.',
  termination: 'לא נמצא תהליך מאושר לסיום העסקה בתיק. אין אפשרות לקבוע בבטחה את הצעדים הבאים.',
  hospitalized: 'לא נמצא תהליך מאושר למקרה אשפוז בתיק. אין אפשרות לקבוע בבטחה את הצעדים הבאים.',
  died: 'לא נמצא תהליך מאושר למקרה פטירה בתיק. אין אפשרות לקבוע בבטחה את הצעדים הבאים; מומלץ לפנות לגורם מקצועי.',
  institution:
    'לא נמצא תהליך מאושר למעבר למוסד או בית אבות בתיק. אין אפשרות לקבוע בבטחה את הצעדים הבאים.',
  notReturned:
    'לא נמצא תהליך מאושר למצב שבו המטפל/ת לא חזר/ה בתיק. אין אפשרות לקבוע בבטחה את הצעדים הבאים.',
  replace: 'לא נמצא תהליך מאושר להחלפת מטפל/ת בתיק. אין אפשרות לקבוע בבטחה את הצעדים הבאים.',
};

export function AutomationPanel({ caseId }: { caseId: string }) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>('home');
  const [departure, setDeparture] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [eventType, setEventType] = useState<EventType>();
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const valid = datesValid(departure, returnDate);
  const departureFarInPast = eventType === 'travel' && isFarPastDeparture(departure);
  // Single source of truth for what is shown on screen AND what is saved:
  // the plan view used to render three separate <li>{t(...)} calls while
  // confirmPlan() sent a differently-derived array (with the travel dates
  // appended) built from a second, independent `checklist` array — they
  // matched by coincidence today, but a future edit to either one would let
  // a user confirm one thing and have another saved. `planItems` is now the
  // only array either side reads.
  const planItems = useMemo(() => {
    const checklist = [
      t('automation.checkDocuments'),
      t('automation.reviewTasks'),
      t('automation.professionalReview'),
    ];
    return checklist.map((item) =>
      eventType === 'travel' ? `${item} (${departure}–${returnDate})` : item,
    );
  }, [t, eventType, departure, returnDate]);
  // Defect: confirmAssistantChecklist used to mint a fresh idempotency key
  // inside client.ts on every call, so retrying after a lost response (same
  // plan, same click) created a second, duplicate checklist confirmation on
  // the server. The key is now assembled once per distinct plan and reused
  // across retries; it only changes when the underlying plan actually does.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: newIdempotencyKey() doesn't read `planItems`, but planItems is what defines "the same logical plan" for retry-safety.
  const confirmIdempotencyKey = useMemo(() => newIdempotencyKey(), [planItems]);
  async function confirmPlan() {
    setSaveState('saving');
    try {
      await confirmAssistantChecklist(caseId, planItems, confirmIdempotencyKey);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }
  return (
    <section className="automation-panel" aria-labelledby="automation-title">
      <div>
        <span className="automation-label">{t('automation.safeLabel')}</span>
        <h2 id="automation-title">{t('automation.title')}</h2>
        <p>{t('automation.intro')}</p>
      </div>
      {view === 'home' && (
        <div className="automation-actions">
          <button type="button" className="automation-primary" onClick={() => setView('events')}>
            {t('automation.somethingChanged')}
          </button>
          <button type="button" onClick={() => setView('assistant')}>
            {t('automation.travelCheck')}
          </button>
        </div>
      )}
      {view === 'events' && (
        <div>
          <h3>{t('automation.chooseEvent')}</h3>
          <div className="event-grid">
            <button
              type="button"
              onClick={() => {
                setEventType('travel');
                setSaveState('idle');
                setView('travel');
              }}
            >
              {t('automation.events.travel')}
            </button>
            {[
              'resigned',
              'termination',
              'hospitalized',
              'died',
              'institution',
              'notReturned',
              'replace',
            ].map((event) => (
              <button
                type="button"
                key={event}
                onClick={() => {
                  setEventType(event as EventType);
                  setSaveState('idle');
                  setView('plan');
                }}
              >
                {t(`automation.events.${event}`)}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setView('home')}>
            {t('automation.back')}
          </button>
        </div>
      )}
      {view === 'travel' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) {
              setSaveState('idle');
              setView('plan');
            }
          }}
        >
          <h3>{t('automation.events.travel')}</h3>
          <label>
            {t('automation.departureDate')}
            <input
              type="date"
              required
              value={departure}
              onChange={(event) => setDeparture(event.target.value)}
            />
          </label>
          <label>
            {t('automation.returnDate')}
            <input
              type="date"
              required
              value={returnDate}
              min={departure}
              onChange={(event) => setReturnDate(event.target.value)}
            />
          </label>
          {returnDate && !valid ? <p role="alert">{t('automation.dateOrderError')}</p> : null}
          {departureFarInPast ? (
            // Non-blocking: a plan may legitimately be recorded after the
            // fact (Constitution §13), so an unusually old departure date
            // gets a warning, not a rejection.
            <p role="status" className="automation-warning">
              תאריך היציאה רחוק בעבר. אפשר להמשיך אם התאריך נכון בדיעבד.
            </p>
          ) : null}
          <button className="automation-primary" type="submit" disabled={!valid}>
            {t('automation.createPlan')}
          </button>
          <button type="button" onClick={() => setView('home')}>
            {t('automation.cancel')}
          </button>
        </form>
      )}
      {view === 'plan' && (
        <div className="automation-plan">
          <h3>{t('automation.planTitle')}</h3>
          <p className="automation-uncertain">
            {eventType ? NO_APPROVED_RULE_TEXT[eventType] : t('automation.noApprovedRule')}
          </p>
          <ul>
            {planItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <button
            type="button"
            className="automation-primary"
            disabled={saveState === 'saving' || saveState === 'saved'}
            onClick={() => void confirmPlan()}
          >
            {t('automation.confirmTasks')}
          </button>
          {saveState === 'saving' ? <p role="status">{t('automation.savingPlan')}</p> : null}
          {saveState === 'saved' ? <p role="status">{t('automation.planSaved')}</p> : null}
          {saveState === 'error' ? <p role="alert">{t('automation.planSaveFailed')}</p> : null}
          <button type="button" onClick={() => setView('home')}>
            {t('automation.cancelNoSave')}
          </button>
        </div>
      )}
      {view === 'assistant' && (
        <div className="automation-plan">
          <h3>{t('automation.assistantTitle')}</h3>
          <span className="automation-label">{t('automation.aiGenerated')}</span>
          <p>{t('automation.assistantUnavailable')}</p>
          <ul>
            <li>{t('automation.checkDocuments')}</li>
            <li>{t('automation.reviewTasks')}</li>
          </ul>
          <button type="button" onClick={() => setView('home')}>
            {t('automation.manualAlternative')}
          </button>
        </div>
      )}
    </section>
  );
}

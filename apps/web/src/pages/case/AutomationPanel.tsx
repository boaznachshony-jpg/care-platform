import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { confirmAssistantChecklist } from '../../api/client.js';

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

export function AutomationPanel({ caseId }: { caseId: string }) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>('home');
  const [departure, setDeparture] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [eventType, setEventType] = useState<EventType>();
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const valid = Boolean(departure && returnDate && returnDate > departure);
  const checklist = [
    t('automation.checkDocuments'),
    t('automation.reviewTasks'),
    t('automation.professionalReview'),
  ];
  async function confirmPlan() {
    setSaveState('saving');
    try {
      await confirmAssistantChecklist(
        caseId,
        checklist.map((item) =>
          eventType === 'travel' ? `${item} (${departure}–${returnDate})` : item,
        ),
      );
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
          <p className="automation-uncertain">{t('automation.noApprovedRule')}</p>
          <ul>
            <li>{t('automation.checkDocuments')}</li>
            <li>{t('automation.reviewTasks')}</li>
            <li>{t('automation.professionalReview')}</li>
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

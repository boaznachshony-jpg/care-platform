import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useClientPath } from '../hooks/use-client-path.js';
import { useMvpProfile } from '../hooks/use-mvp-profile.js';
import type { ReminderLeadDays } from '../storage/mvp-storage.js';
import { isValidIsraeliId, normalizeIsraeliId } from '../validation/israeli-id.js';

export function SettingsPage() {
  const path = useClientPath();
  const { t } = useTranslation();
  const [profile, setProfile] = useMvpProfile();
  const [draft, setDraft] = useState(profile);
  const [saved, setSaved] = useState(false);
  const [notificationResult, setNotificationResult] = useState('');
  const employerIdIsValid = isValidIsraeliId(draft.employerIdNumber);

  useEffect(() => {
    setSaved(false);
  }, [draft]);

  async function requestNotification() {
    if (!('Notification' in window)) {
      setNotificationResult(t('settings.notificationsUnsupported'));
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationResult(t(`settings.permission.${permission}`));
  }

  function testNotification() {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(t('settings.testTitle'), { body: t('settings.testBody') });
      setNotificationResult(t('settings.testSent'));
    } else {
      setNotificationResult(t('settings.permissionNeeded'));
    }
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('settings.eyebrow')}</p>
          <h1>{t('settings.title')}</h1>
          <p>{t('settings.intro')}</p>
        </div>
        <Link className="secondary-button" to={path('/onboarding')}>
          {t('settings.reopenOnboarding')}
        </Link>
        <Link className="secondary-button" to="/family">
          👥 {t('familyAccess.eyebrow')}
        </Link>
        <Link className="secondary-button" to="/billing">
          💳 {t('billing.eyebrow')}
        </Link>
      </header>
      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!employerIdIsValid) return;
          setProfile(draft);
          setSaved(true);
        }}
      >
        <section className="card readable-form">
          <h2>{t('settings.employer')}</h2>
          <label>
            {t('profile.employerName')}
            <input
              value={draft.employerName}
              required
              onChange={(event) => setDraft({ ...draft, employerName: event.target.value })}
            />
          </label>
          <label>
            מספר תעודת זהות
            <input
              dir="ltr"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={draft.employerIdNumber}
              required
              aria-invalid={!employerIdIsValid}
              aria-describedby={
                employerIdIsValid
                  ? 'settings-employer-id-help'
                  : 'settings-employer-id-help settings-employer-id-error'
              }
              onBlur={() => {
                if (employerIdIsValid) {
                  setDraft({
                    ...draft,
                    employerIdNumber: normalizeIsraeliId(draft.employerIdNumber),
                  });
                }
              }}
              onChange={(event) => setDraft({ ...draft, employerIdNumber: event.target.value })}
            />
            <small id="settings-employer-id-help">נדרש לצורך דיווח לביטוח לאומי בלבד.</small>
            {!employerIdIsValid ? (
              <span id="settings-employer-id-error" className="field-error" role="alert">
                מספר תעודת הזהות אינו תקין. יש לבדוק את 9 הספרות ואת ספרת הביקורת.
              </span>
            ) : null}
          </label>
          <label>
            {t('profile.phone')}
            <input
              dir="ltr"
              type="tel"
              value={draft.employerPhone}
              required
              onChange={(event) => setDraft({ ...draft, employerPhone: event.target.value })}
            />
          </label>
        </section>
        <section className="card readable-form">
          <h2>{t('settings.representative')}</h2>
          <p>{t('familyAccess.contactDisclaimer')}</p>
          <label>
            {t('profile.representativeName')}
            <input
              value={draft.representativeName}
              required
              onChange={(event) => setDraft({ ...draft, representativeName: event.target.value })}
            />
          </label>
          <label>
            {t('profile.phone')}
            <input
              dir="ltr"
              type="tel"
              value={draft.representativePhone}
              required
              onChange={(event) => setDraft({ ...draft, representativePhone: event.target.value })}
            />
          </label>
        </section>
        <section className="card readable-form">
          <h2>{t('settings.licensedBureau')}</h2>
          <p>{t('settings.licensedBureauIntro')}</p>
          <label>
            {t('profile.licensedBureauName')}
            <input
              value={draft.licensedBureauName}
              onChange={(event) => setDraft({ ...draft, licensedBureauName: event.target.value })}
            />
          </label>
          <label>
            {t('profile.licensedBureauRegistrationNumber')}
            <input
              dir="ltr"
              value={draft.licensedBureauRegistrationNumber}
              onChange={(event) =>
                setDraft({ ...draft, licensedBureauRegistrationNumber: event.target.value })
              }
            />
          </label>
          <div className="form-grid two-columns">
            <label>
              {t('profile.licensedBureauContactName')}
              <input
                value={draft.licensedBureauContactName}
                onChange={(event) =>
                  setDraft({ ...draft, licensedBureauContactName: event.target.value })
                }
              />
            </label>
            <label>
              {t('profile.licensedBureauContactPhone')}
              <input
                dir="ltr"
                type="tel"
                value={draft.licensedBureauContactPhone}
                onChange={(event) =>
                  setDraft({ ...draft, licensedBureauContactPhone: event.target.value })
                }
              />
            </label>
          </div>
          <label>
            {t('profile.licensedBureauContactEmail')}
            <input
              dir="ltr"
              type="email"
              value={draft.licensedBureauContactEmail}
              onChange={(event) =>
                setDraft({ ...draft, licensedBureauContactEmail: event.target.value })
              }
            />
          </label>
        </section>
        <section className="card readable-form">
          <h2>{t('settings.medicalInsurance')}</h2>
          <label className="switch-row">
            <span>{t('onboarding.medicalInsuranceConfirmed')}</span>
            <input
              type="checkbox"
              checked={draft.medicalInsuranceConfirmed}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  medicalInsuranceConfirmed: event.target.checked,
                  medicalInsuranceExpiryDate: event.target.checked
                    ? draft.medicalInsuranceExpiryDate
                    : '',
                })
              }
            />
          </label>
          <label>
            {t('onboarding.medicalInsuranceExpiryDate')}
            <input
              dir="ltr"
              type="date"
              value={draft.medicalInsuranceExpiryDate}
              required={draft.medicalInsuranceConfirmed}
              disabled={!draft.medicalInsuranceConfirmed}
              onChange={(event) =>
                setDraft({ ...draft, medicalInsuranceExpiryDate: event.target.value })
              }
            />
            <small>{t('onboarding.medicalInsuranceExpiryHelp')}</small>
          </label>
        </section>
        <section className="card readable-form notification-settings">
          <h2>{t('settings.notifications')}</h2>
          <label className="switch-row">
            <span>{t('settings.masterSwitch')}</span>
            <input
              type="checkbox"
              checked={draft.notificationsEnabled}
              onChange={(event) =>
                setDraft({ ...draft, notificationsEnabled: event.target.checked })
              }
            />
          </label>
          <label>
            {t('settings.reminderLead')}
            <select
              value={draft.reminderLeadDays}
              disabled={!draft.notificationsEnabled}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  reminderLeadDays: Number(event.target.value) as ReminderLeadDays,
                })
              }
            >
              {[1, 7, 14, 21, 30].map((days) => (
                <option key={days} value={days}>
                  {t('settings.daysBefore', { count: days })}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid two-columns">
            <label>
              {t('settings.quietStart')}
              <input
                type="time"
                value={draft.quietHoursStart}
                onChange={(event) => setDraft({ ...draft, quietHoursStart: event.target.value })}
              />
            </label>
            <label>
              {t('settings.quietEnd')}
              <input
                type="time"
                value={draft.quietHoursEnd}
                onChange={(event) => setDraft({ ...draft, quietHoursEnd: event.target.value })}
              />
            </label>
          </div>
          <div className="button-row">
            <button
              className="secondary-button"
              type="button"
              onClick={() => void requestNotification()}
            >
              {t('settings.allowBrowser')}
            </button>
            <button className="secondary-button" type="button" onClick={testNotification}>
              {t('settings.testNotification')}
            </button>
          </div>
          {notificationResult ? <p role="status">{notificationResult}</p> : null}
        </section>
        <div className="save-bar">
          {saved ? <span role="status">{t('settings.saved')}</span> : <span />}
          <button className="primary-button" type="submit" disabled={!employerIdIsValid}>
            {t('settings.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

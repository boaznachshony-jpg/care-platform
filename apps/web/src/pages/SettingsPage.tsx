import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { LicensedBureauSelector } from '../components/LicensedBureauSelector.js';
import { RegulationRulesAdmin } from '../components/RegulationRulesAdmin.js';
import { useClientPath } from '../hooks/use-client-path.js';
import { useMvpProfile } from '../hooks/use-mvp-profile.js';
import type { ReminderLeadDays } from '../storage/mvp-storage.js';
import { isValidIsraeliId, normalizeIsraeliId } from '../validation/israeli-id.js';
import {
  isValidEmail,
  isValidIsoDate,
  isValidPassportNumber,
  isValidPersonName,
  isValidPhone,
  normalizePassportNumber,
} from '../validation/onboarding-fields.js';

export function SettingsPage() {
  const path = useClientPath();
  const { t } = useTranslation();
  const [profile, setProfile] = useMvpProfile();
  const [draft, setDraft] = useState(profile);
  const [saved, setSaved] = useState(false);
  const [notificationResult, setNotificationResult] = useState('');
  const employerIdIsValid = isValidIsraeliId(draft.employerIdNumber);
  const recipientIdIsValid =
    draft.recipientIdNumber.length === 0 || isValidIsraeliId(draft.recipientIdNumber);
  const representativeHasData = Boolean(
    draft.representativeName ||
    draft.representativePhone ||
    draft.representativeEmail ||
    draft.representativeRelationship,
  );
  const representativeIsValid =
    !representativeHasData ||
    (isValidPersonName(draft.representativeName) &&
      isValidPhone(draft.representativePhone) &&
      (!draft.representativeEmail || isValidEmail(draft.representativeEmail)));
  const contactDetailsAreValid =
    isValidPersonName(draft.recipientName) &&
    (!draft.recipientBirthDate || isValidIsoDate(draft.recipientBirthDate)) &&
    (!draft.recipientPhone || isValidPhone(draft.recipientPhone)) &&
    (!draft.recipientEmail || isValidEmail(draft.recipientEmail)) &&
    isValidPersonName(draft.employerName) &&
    isValidPhone(draft.employerPhone) &&
    (!draft.employerEmail || isValidEmail(draft.employerEmail)) &&
    (!draft.caregiverPassportNumber || isValidPassportNumber(draft.caregiverPassportNumber)) &&
    representativeIsValid;
  const profileIsValid = employerIdIsValid && recipientIdIsValid && contactDetailsAreValid;

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
          if (!profileIsValid) return;
          setProfile(draft);
          setSaved(true);
        }}
      >
        <section className="card readable-form" aria-labelledby="client-profile-safety-title">
          <h2 id="client-profile-safety-title">{t('settings.dataSafetyTitle')}</h2>
          <p>{t('settings.dataSafetyBody')}</p>
        </section>
        <section className="card readable-form">
          <h2>{t('settings.recipient')}</h2>
          <div className="form-grid two-columns">
            <label>
              {t('profile.recipientName')}
              <input
                autoComplete="name"
                value={draft.recipientName}
                required
                onChange={(event) => setDraft({ ...draft, recipientName: event.target.value })}
              />
            </label>
            <label>
              {t('profile.recipientIdNumber')}
              <input
                id="settings-recipient-id"
                dir="ltr"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                value={draft.recipientIdNumber}
                aria-invalid={!recipientIdIsValid}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    recipientIdNumber: normalizeIsraeliId(event.target.value),
                  })
                }
              />
              {!recipientIdIsValid ? (
                <span className="field-error" role="alert">
                  {t('profile.idError')}
                </span>
              ) : null}
            </label>
            <label>
              {t('profile.birthDate')}
              <input
                dir="ltr"
                type="date"
                value={draft.recipientBirthDate}
                onChange={(event) => setDraft({ ...draft, recipientBirthDate: event.target.value })}
              />
            </label>
            <label>
              {t('profile.phone')}
              <input
                dir="ltr"
                type="tel"
                autoComplete="tel"
                value={draft.recipientPhone}
                onChange={(event) => setDraft({ ...draft, recipientPhone: event.target.value })}
              />
            </label>
            <label>
              {t('profile.email')}
              <input
                dir="ltr"
                type="email"
                autoComplete="email"
                value={draft.recipientEmail}
                onChange={(event) => setDraft({ ...draft, recipientEmail: event.target.value })}
              />
            </label>
            <label>
              {t('profile.healthFund')}
              <input
                value={draft.recipientHealthFund}
                onChange={(event) =>
                  setDraft({ ...draft, recipientHealthFund: event.target.value })
                }
              />
            </label>
            <label>
              {t('profile.careLevel')}
              <input
                value={draft.recipientCareLevel}
                onChange={(event) => setDraft({ ...draft, recipientCareLevel: event.target.value })}
              />
            </label>
            <label>
              {t('profile.nationalInsuranceCaseNumber')}
              <input
                dir="ltr"
                value={draft.recipientNationalInsuranceCaseNumber}
                onChange={(event) =>
                  setDraft({ ...draft, recipientNationalInsuranceCaseNumber: event.target.value })
                }
              />
            </label>
            <label>
              {t('profile.address')}
              <input
                autoComplete="street-address"
                value={draft.recipientAddress}
                onChange={(event) => setDraft({ ...draft, recipientAddress: event.target.value })}
              />
            </label>
            <label>
              {t('profile.city')}
              <input
                autoComplete="address-level2"
                value={draft.recipientCity}
                onChange={(event) => setDraft({ ...draft, recipientCity: event.target.value })}
              />
            </label>
            <label>
              {t('profile.postalCode')}
              <input
                dir="ltr"
                inputMode="numeric"
                autoComplete="postal-code"
                value={draft.recipientPostalCode}
                onChange={(event) =>
                  setDraft({ ...draft, recipientPostalCode: event.target.value })
                }
              />
            </label>
          </div>
        </section>
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
              id="settings-employer-id"
              dir="ltr"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              value={draft.employerIdNumber}
              required
              aria-invalid={!employerIdIsValid}
              aria-describedby={
                employerIdIsValid
                  ? 'settings-employer-id-help'
                  : 'settings-employer-id-help settings-employer-id-error'
              }
              onChange={(event) =>
                setDraft({
                  ...draft,
                  employerIdNumber: normalizeIsraeliId(event.target.value),
                })
              }
            />
            <small id="settings-employer-id-help">
              נדרש לצורך דיווח לביטוח לאומי. יש להזין 9 ספרות בלבד, ללא רווחים וללא מקפים.
            </small>
            {!employerIdIsValid ? (
              <span id="settings-employer-id-error" className="field-error" role="alert">
                מספר תעודת הזהות אינו תקין. יש לבדוק את 9 הספרות ואת ספרת הביקורת.
              </span>
            ) : null}
          </label>
          <label>
            {t('profile.phone')}
            <input
              id="settings-employer-phone"
              dir="ltr"
              type="tel"
              value={draft.employerPhone}
              required
              onChange={(event) => setDraft({ ...draft, employerPhone: event.target.value })}
            />
          </label>
          <div className="form-grid two-columns">
            <label>
              {t('profile.email')}
              <input
                dir="ltr"
                type="email"
                autoComplete="email"
                value={draft.employerEmail}
                onChange={(event) => setDraft({ ...draft, employerEmail: event.target.value })}
              />
            </label>
            <label>
              {t('profile.relationship')}
              <input
                value={draft.employerRelationship}
                onChange={(event) =>
                  setDraft({ ...draft, employerRelationship: event.target.value })
                }
              />
            </label>
            <label>
              {t('profile.address')}
              <input
                autoComplete="street-address"
                value={draft.employerAddress}
                onChange={(event) => setDraft({ ...draft, employerAddress: event.target.value })}
              />
            </label>
            <label>
              {t('profile.city')}
              <input
                autoComplete="address-level2"
                value={draft.employerCity}
                onChange={(event) => setDraft({ ...draft, employerCity: event.target.value })}
              />
            </label>
            <label>
              {t('profile.postalCode')}
              <input
                dir="ltr"
                inputMode="numeric"
                autoComplete="postal-code"
                value={draft.employerPostalCode}
                onChange={(event) => setDraft({ ...draft, employerPostalCode: event.target.value })}
              />
            </label>
          </div>
        </section>
        <section className="card readable-form">
          <h2>{t('settings.caregiver')}</h2>
          <div className="form-grid two-columns">
            <label>
              {t('profile.caregiverName')}
              <input
                value={draft.caregiverName}
                onChange={(event) => setDraft({ ...draft, caregiverName: event.target.value })}
              />
            </label>
            <label>
              {t('profile.caregiverPassportNumber')}
              <input
                dir="ltr"
                type="text"
                inputMode="text"
                pattern="[A-Za-z0-9]*"
                autoComplete="off"
                maxLength={20}
                value={draft.caregiverPassportNumber}
                aria-invalid={
                  Boolean(draft.caregiverPassportNumber) &&
                  !isValidPassportNumber(draft.caregiverPassportNumber)
                }
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    caregiverPassportNumber: normalizePassportNumber(event.target.value),
                  })
                }
              />
              <small>{t('profile.caregiverPassportHelp')}</small>
              {draft.caregiverPassportNumber &&
              !isValidPassportNumber(draft.caregiverPassportNumber) ? (
                <span className="field-error" role="alert">
                  {t('profile.caregiverPassportError')}
                </span>
              ) : null}
            </label>
            <label>
              {t('profile.caregiverCountry')}
              <input
                value={draft.caregiverCountry}
                onChange={(event) => setDraft({ ...draft, caregiverCountry: event.target.value })}
              />
            </label>
            <label>
              {t('profile.caregiverLanguage')}
              <input
                value={draft.caregiverLanguage}
                onChange={(event) => setDraft({ ...draft, caregiverLanguage: event.target.value })}
              />
            </label>
            <label>
              {t('profile.employmentStartDate')}
              <input
                dir="ltr"
                type="date"
                value={draft.employmentStartDate}
                onChange={(event) =>
                  setDraft({ ...draft, employmentStartDate: event.target.value })
                }
              />
            </label>
          </div>
        </section>
        <section className="card readable-form">
          <h2>{t('settings.representative')}</h2>
          <p>{t('familyAccess.contactDisclaimer')}</p>
          <label>
            {t('profile.representativeName')}
            <input
              value={draft.representativeName}
              onChange={(event) => setDraft({ ...draft, representativeName: event.target.value })}
            />
          </label>
          <label>
            {t('profile.phone')}
            <input
              id="settings-representative-phone"
              dir="ltr"
              type="tel"
              value={draft.representativePhone}
              onChange={(event) => setDraft({ ...draft, representativePhone: event.target.value })}
            />
          </label>
          <div className="form-grid two-columns">
            <label>
              {t('profile.email')}
              <input
                dir="ltr"
                type="email"
                value={draft.representativeEmail}
                onChange={(event) =>
                  setDraft({ ...draft, representativeEmail: event.target.value })
                }
              />
            </label>
            <label>
              {t('profile.relationship')}
              <input
                value={draft.representativeRelationship}
                onChange={(event) =>
                  setDraft({ ...draft, representativeRelationship: event.target.value })
                }
              />
            </label>
          </div>
        </section>
        <section className="card readable-form">
          <h2>{t('settings.licensedBureau')}</h2>
          <p>{t('settings.licensedBureauIntro')}</p>
          <LicensedBureauSelector profile={draft} onChange={setDraft} />
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
          <button className="primary-button" type="submit" disabled={!profileIsValid}>
            {t('settings.save')}
          </button>
        </div>
      </form>
      {/* Reviewed regulation content lifecycle (capability #11) — server-backed,
          manager-only mutations; deliberately outside the local profile form. */}
      <RegulationRulesAdmin />
    </div>
  );
}

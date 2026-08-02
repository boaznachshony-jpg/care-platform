/* eslint-disable no-restricted-syntax */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useClientPath } from '../hooks/use-client-path.js';
import { useMvpProfile } from '../hooks/use-mvp-profile.js';
import { caregiverCountries, caregiverLanguages, suggestedLanguage } from '../caregiver-options.js';
import { isValidIsraeliId, normalizeIsraeliId } from '../validation/israeli-id.js';

export function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const path = useClientPath();
  const [profile, setProfile] = useMvpProfile();
  const [draft, setDraft] = useState(profile);
  const [step, setStep] = useState(0);

  const sections = [
    {
      title: t('onboarding.people'),
      fields: [
        ['employerName', t('profile.employerName'), 'text'],
        ['employerIdNumber', 'מספר תעודת זהות', 'israeli-id'],
        ['employerPhone', t('profile.phone'), 'tel'],
        ['recipientName', t('profile.recipientName'), 'text'],
      ],
    },
    {
      title: t('onboarding.employment'),
      fields: [
        ['caregiverName', t('profile.caregiverName'), 'text'],
        ['caregiverCountry', 'ארץ מוצא', 'country'],
        ['caregiverLanguage', 'שפה מועדפת', 'language'],
        ['employmentStartDate', t('profile.startDate'), 'date'],
      ],
    },
    {
      title: t('onboarding.support'),
      fields: [
        ['representativeName', t('profile.representativeName'), 'text'],
        ['representativePhone', t('profile.phone'), 'tel'],
      ],
    },
  ] as const;

  const current = sections[step] ?? sections[0];
  const isValid = current.fields.every(
    ([key, , type]) =>
      draft[key].trim().length > 0 &&
      (type !== 'israeli-id' || isValidIsraeliId(draft.employerIdNumber)),
  );

  function complete() {
    setProfile({ ...draft, onboardingCompleted: true });
    navigate(path('/'));
  }

  return (
    <div className="page-stack onboarding-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('onboarding.eyebrow')}</p>
          <h1>{t('onboarding.title')}</h1>
          <p>{t('onboarding.intro')}</p>
        </div>
        <span className="progress-label">
          {t('onboarding.progress', { current: step + 1, total: sections.length })}
        </span>
      </header>
      <section className="wizard-card" aria-labelledby="onboarding-step">
        <div className="onboarding-progress" aria-hidden="true">
          {sections.map((section, index) => (
            <span key={section.title} className={index <= step ? 'active' : ''} />
          ))}
        </div>
        <form
          className="wizard-content readable-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (step === sections.length - 1) complete();
            else setStep((value) => value + 1);
          }}
        >
          <h2 id="onboarding-step">{current.title}</h2>
          <p>{t('onboarding.stepHint')}</p>
          {current.fields.map(([key, label, type]) => (
            <label key={key}>
              {label}
              {type === 'country' || type === 'language' ? (
                <select
                  value={draft[key]}
                  required
                  onChange={(event) => {
                    const value = event.target.value;
                    setDraft({
                      ...draft,
                      [key]: value,
                      ...(type === 'country' && !draft.caregiverLanguage
                        ? { caregiverLanguage: suggestedLanguage(value) }
                        : {}),
                    });
                  }}
                >
                  <option value="">בחירה</option>
                  {(type === 'country' ? caregiverCountries : caregiverLanguages).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : type === 'israeli-id' ? (
                <>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={draft.employerIdNumber}
                    required
                    dir="ltr"
                    aria-invalid={
                      draft.employerIdNumber.length > 0 && !isValidIsraeliId(draft.employerIdNumber)
                    }
                    aria-describedby={
                      draft.employerIdNumber.length > 0 && !isValidIsraeliId(draft.employerIdNumber)
                        ? 'employer-id-help employer-id-error'
                        : 'employer-id-help'
                    }
                    onBlur={() => {
                      if (isValidIsraeliId(draft.employerIdNumber)) {
                        setDraft({
                          ...draft,
                          employerIdNumber: normalizeIsraeliId(draft.employerIdNumber),
                        });
                      }
                    }}
                    onChange={(event) =>
                      setDraft({ ...draft, employerIdNumber: event.target.value })
                    }
                  />
                  <small id="employer-id-help">
                    נדרש לצורך דיווח לביטוח לאומי בלבד. ניתן להזין ספרות, רווחים או מקפים.
                  </small>
                  {draft.employerIdNumber.length > 0 &&
                  !isValidIsraeliId(draft.employerIdNumber) ? (
                    <span id="employer-id-error" className="field-error" role="alert">
                      מספר תעודת הזהות אינו תקין. יש לבדוק את 9 הספרות ואת ספרת הביקורת.
                    </span>
                  ) : null}
                </>
              ) : (
                <input
                  type={type}
                  value={draft[key]}
                  required
                  dir={type === 'tel' || type === 'date' ? 'ltr' : undefined}
                  onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                />
              )}
            </label>
          ))}
          <div className="wizard-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={step === 0}
              onClick={() => setStep((value) => value - 1)}
            >
              {t('common.back')}
            </button>
            <button className="primary-button" type="submit" disabled={!isValid}>
              {step === sections.length - 1 ? t('onboarding.finish') : t('common.continue')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

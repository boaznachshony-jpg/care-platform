import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useClientPath } from '../hooks/use-client-path.js';
import { useMvpProfile } from '../hooks/use-mvp-profile.js';
import { caregiverCountries, caregiverLanguages, suggestedLanguage } from '../caregiver-options.js';
import { LicensedBureauSelector } from '../components/LicensedBureauSelector.js';
import type { MvpProfile } from '../storage/mvp-storage.js';
import { isValidIsraeliId, normalizeIsraeliId } from '../validation/israeli-id.js';

type DetailFieldKey =
  | 'employerName'
  | 'employerIdNumber'
  | 'employerPhone'
  | 'recipientName'
  | 'caregiverName'
  | 'caregiverCountry'
  | 'caregiverLanguage'
  | 'employmentStartDate'
  | 'representativeName'
  | 'representativePhone'
  | 'licensedBureauName'
  | 'licensedBureauRegistrationNumber'
  | 'licensedBureauContactName'
  | 'licensedBureauContactPhone'
  | 'licensedBureauContactEmail';

type DetailFieldType = 'text' | 'tel' | 'email' | 'date' | 'israeli-id' | 'country' | 'language';

interface DetailField {
  key: DetailFieldKey;
  label: string;
  type: DetailFieldType;
}

export function employmentSetupCompletedCount(profile: MvpProfile): number {
  return [
    profile.employmentAgreementConfirmed,
    profile.medicalInsuranceConfirmed && Boolean(profile.medicalInsuranceExpiryDate),
    (profile.baseSalary ?? 0) > 0,
    (profile.saturdayRate ?? 0) > 0,
    Boolean(profile.licenseRenewalDate),
    Boolean(profile.employmentFeeDueDate),
  ].filter(Boolean).length;
}

export function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const path = useClientPath();
  const [profile, setProfile] = useMvpProfile();
  const [draft, setDraft] = useState(profile);
  const [step, setStep] = useState(0);
  const isFirstRun = !profile.onboardingCompleted;

  const sections = useMemo(
    () => [
      {
        key: 'people',
        title: t('onboarding.people'),
        fields: [
          { key: 'employerName', label: t('profile.employerName'), type: 'text' },
          { key: 'employerIdNumber', label: t('profile.employerIdNumber'), type: 'israeli-id' },
          { key: 'employerPhone', label: t('profile.phone'), type: 'tel' },
          { key: 'recipientName', label: t('profile.recipientName'), type: 'text' },
        ] satisfies DetailField[],
      },
      {
        key: 'employment',
        title: t('onboarding.employment'),
        fields: [
          { key: 'caregiverName', label: t('profile.caregiverName'), type: 'text' },
          { key: 'caregiverCountry', label: t('profile.caregiverCountry'), type: 'country' },
          { key: 'caregiverLanguage', label: t('profile.caregiverLanguage'), type: 'language' },
          { key: 'employmentStartDate', label: t('profile.startDate'), type: 'date' },
        ] satisfies DetailField[],
      },
      {
        key: 'support',
        title: t('onboarding.support'),
        fields: [
          { key: 'representativeName', label: t('profile.representativeName'), type: 'text' },
          { key: 'representativePhone', label: t('profile.phone'), type: 'tel' },
        ] satisfies DetailField[],
      },
      {
        key: 'licensedBureau',
        title: t('onboarding.licensedBureau'),
        fields: [] satisfies DetailField[],
      },
    ],
    [t],
  );

  const checklistComplete = employmentSetupCompletedCount(draft);
  const totalSteps = sections.length + 1;
  const checklistStep = step === sections.length;
  const current = sections[Math.min(step, sections.length - 1)]!;
  const licensedBureauStep = !checklistStep && current.key === 'licensedBureau';
  const detailsValid = licensedBureauStep
    ? Boolean(
        draft.licensedBureauName.trim() &&
        draft.licensedBureauRegistrationNumber.trim() &&
        draft.licensedBureauContactName.trim() &&
        draft.licensedBureauContactPhone.trim(),
      )
    : current.fields.every(
        ({ key, type }) =>
          draft[key].trim().length > 0 &&
          (type !== 'israeli-id' || isValidIsraeliId(draft.employerIdNumber)),
      );
  const isValid = checklistStep ? checklistComplete === 6 : detailsValid;

  function complete() {
    setProfile({
      ...draft,
      salaryEffectiveDate: draft.salaryEffectiveDate || draft.employmentStartDate,
      onboardingCompleted: true,
    });
    navigate(isFirstRun ? '/billing?from=onboarding' : path('/'));
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
          {t('onboarding.progress', { current: step + 1, total: totalSteps })}
        </span>
      </header>

      <aside className="onboarding-checklist-summary" aria-live="polite">
        <span aria-hidden="true">✓</span>
        <div>
          <strong>{t('onboarding.checklist')}</strong>
          <small>
            {t('onboarding.checklistProgress', { completed: checklistComplete, total: 6 })}
          </small>
        </div>
      </aside>

      <section className="wizard-card" aria-labelledby="onboarding-step">
        <div className="onboarding-progress" aria-hidden="true">
          {Array.from({ length: totalSteps }, (_, index) => (
            <span key={index} className={index <= step ? 'active' : ''} />
          ))}
        </div>
        <form
          className="wizard-content readable-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (checklistStep) complete();
            else setStep((value) => value + 1);
          }}
        >
          <h2 id="onboarding-step">{checklistStep ? t('onboarding.checklist') : current.title}</h2>
          <p>{t(checklistStep ? 'onboarding.checklistIntro' : 'onboarding.stepHint')}</p>

          {checklistStep ? (
            <div className="setup-checklist">
              <label className={draft.employmentAgreementConfirmed ? 'complete' : ''}>
                <input
                  type="checkbox"
                  checked={draft.employmentAgreementConfirmed}
                  onChange={(event) =>
                    setDraft({ ...draft, employmentAgreementConfirmed: event.target.checked })
                  }
                />
                <span>{t('onboarding.agreementConfirmed')}</span>
              </label>
              <label
                className={
                  draft.medicalInsuranceConfirmed && draft.medicalInsuranceExpiryDate
                    ? 'complete'
                    : ''
                }
              >
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
                <span>{t('onboarding.medicalInsuranceConfirmed')}</span>
              </label>
              {draft.medicalInsuranceConfirmed ? (
                <label>
                  {t('onboarding.medicalInsuranceExpiryDate')}
                  <input
                    type="date"
                    dir="ltr"
                    required
                    value={draft.medicalInsuranceExpiryDate}
                    onChange={(event) =>
                      setDraft({ ...draft, medicalInsuranceExpiryDate: event.target.value })
                    }
                  />
                  <small>{t('onboarding.medicalInsuranceExpiryHelp')}</small>
                </label>
              ) : null}
              <label>
                {t('onboarding.baseSalary')}
                <input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="0.01"
                  required
                  value={draft.baseSalary ?? ''}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      baseSalary: event.target.value ? Number(event.target.value) : null,
                    })
                  }
                />
              </label>
              <label>
                {t('onboarding.saturdayRate')}
                <input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="0.01"
                  required
                  value={draft.saturdayRate ?? ''}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      saturdayRate: event.target.value ? Number(event.target.value) : null,
                    })
                  }
                />
              </label>
              <small className="setup-checklist-note">
                {t('onboarding.salaryEffectiveNote', { date: draft.employmentStartDate })}
              </small>
              <label>
                {t('onboarding.licenseRenewalDate')}
                <input
                  type="date"
                  dir="ltr"
                  required
                  value={draft.licenseRenewalDate}
                  onChange={(event) =>
                    setDraft({ ...draft, licenseRenewalDate: event.target.value })
                  }
                />
              </label>
              <label>
                {t('onboarding.employmentFeeDueDate')}
                <input
                  type="date"
                  dir="ltr"
                  required
                  value={draft.employmentFeeDueDate}
                  onChange={(event) =>
                    setDraft({ ...draft, employmentFeeDueDate: event.target.value })
                  }
                />
              </label>
            </div>
          ) : licensedBureauStep ? (
            <LicensedBureauSelector profile={draft} onChange={setDraft} required />
          ) : (
            current.fields.map(({ key, label, type }) => (
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
                    <option value="">{t('common.select')}</option>
                    {(type === 'country' ? caregiverCountries : caregiverLanguages).map(
                      (option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ),
                    )}
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
                        draft.employerIdNumber.length > 0 &&
                        !isValidIsraeliId(draft.employerIdNumber)
                      }
                      aria-describedby={
                        draft.employerIdNumber.length > 0 &&
                        !isValidIsraeliId(draft.employerIdNumber)
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
                    <small id="employer-id-help">{t('profile.employerIdHelp')}</small>
                    {draft.employerIdNumber.length > 0 &&
                    !isValidIsraeliId(draft.employerIdNumber) ? (
                      <span id="employer-id-error" className="field-error" role="alert">
                        {t('profile.employerIdError')}
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
            ))
          )}

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
              {checklistStep ? t('onboarding.paymentNext') : t('common.continue')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

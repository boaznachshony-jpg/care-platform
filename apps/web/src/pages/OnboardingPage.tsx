import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PRIVACY_DOCUMENT_VERSION, TERMS_DOCUMENT_VERSION } from '@caredesk/i18n';
import type { LegalAcceptanceRequest } from '@caredesk/schemas';
import { ApiRequestError, getBillingSubscription, recordLegalAcceptance } from '../api/client.js';
import {
  caregiverCountries,
  caregiverLanguages,
  languageAfterCountryChange,
} from '../caregiver-options.js';
import { ensureCanonicalCase, LEGACY_UNSCOPED_CLIENT_ID } from '../canonical-case.js';
import { AutocompleteField } from '../components/AutocompleteField.js';
import { LicensedBureauSelector } from '../components/LicensedBureauSelector.js';
import { israeliLocalities } from '../data/israeli-localities.js';
import { useClientPath } from '../hooks/use-client-path.js';
import { useMvpProfile } from '../hooks/use-mvp-profile.js';
import {
  clearMvpOnboardingDraft,
  readMvpOnboardingDraft,
  saveMvpOnboardingDraft,
  withSamePersonFallbacks,
  type MvpProfile,
} from '../storage/mvp-storage.js';
import {
  getIsraeliIdValidationError,
  isValidIsraeliId,
  normalizeIsraeliId,
} from '../validation/israeli-id.js';
import {
  isPositiveMoney,
  isValidEmail,
  isValidIsoDate,
  isValidOrganizationName,
  isValidPersonName,
  isValidPhone,
  isValidRegistrationNumber,
} from '../validation/onboarding-fields.js';

type ProfileStringKey = {
  [Key in keyof MvpProfile]: MvpProfile[Key] extends string ? Key : never;
}[keyof MvpProfile];

type Choice = '' | 'yes' | 'no';

const LAST_STEP = 5;
const DRAFT_SAVE_DELAY_MS = 500;

function stepStorageKey(clientId: string): string {
  return `caredesk.onboarding.step.${clientId || 'default'}`;
}

/**
 * Defect fix: `complete()` used to end with
 * `recordLegalAcceptance({...}).catch(() => undefined)`, on the theory that
 * the billing flow re-records the same acceptance. That is only true for a
 * customer who actually reaches /billing — a customer who closes the tab
 * right after finishing onboarding never does, and the account then holds a
 * caregiver's identity documents, visa data and payroll details with no
 * record anyone accepted the terms at all.
 *
 * Onboarding must still complete offline (constitution §13: an error here
 * cannot destroy the user's completed setup), so the fix cannot make the
 * click block on the network. Instead a failure leaves a trace: the exact
 * request is written to localStorage — account-scoped, not client-scoped,
 * because legal acceptance itself is (recordLegalAcceptance takes no
 * clientId) — and is retried the next time this page mounts (a customer
 * with more than one client returns here again) and whenever the browser
 * regains connectivity. The record is idempotent per (user, document,
 * version), so a retry after the billing flow already recorded it, or a
 * retry firing twice, is a harmless no-op.
 */
const PENDING_LEGAL_ACCEPTANCE_KEY = 'caredesk.onboarding.pending-legal-acceptance.v1';

function readPendingLegalAcceptance(): LegalAcceptanceRequest | null {
  try {
    const raw = window.localStorage.getItem(PENDING_LEGAL_ACCEPTANCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LegalAcceptanceRequest>;
    return Array.isArray(parsed.documents) && parsed.documents.length > 0 && parsed.context
      ? (parsed as LegalAcceptanceRequest)
      : null;
  } catch {
    return null;
  }
}

function writePendingLegalAcceptance(input: LegalAcceptanceRequest): void {
  window.localStorage.setItem(PENDING_LEGAL_ACCEPTANCE_KEY, JSON.stringify(input));
}

function clearPendingLegalAcceptance(): void {
  window.localStorage.removeItem(PENDING_LEGAL_ACCEPTANCE_KEY);
}

/** Retries a queued acceptance; leaves it queued for the next attempt on failure. */
function flushPendingLegalAcceptance(): void {
  const pending = readPendingLegalAcceptance();
  if (!pending) return;
  void recordLegalAcceptance(pending)
    .then(() => clearPendingLegalAcceptance())
    .catch(() => undefined);
}

function readSavedStep(clientId: string): number {
  const value = Number(window.localStorage.getItem(stepStorageKey(clientId)) ?? 0);
  return Number.isInteger(value) && value >= 0 && value <= LAST_STEP ? value : 0;
}

export function employmentSetupCompletedCount(profile: MvpProfile): number {
  return [
    profile.employmentAgreementConfirmed,
    profile.medicalInsuranceConfirmed && isValidIsoDate(profile.medicalInsuranceExpiryDate),
    isPositiveMoney(profile.baseSalary),
    isPositiveMoney(profile.saturdayRate),
    isValidIsoDate(profile.licenseRenewalDate),
    isValidIsoDate(profile.visaRenewalDate),
  ].filter(Boolean).length;
}

function bureauDetailsValid(profile: MvpProfile): boolean {
  return (
    isValidOrganizationName(profile.licensedBureauName) &&
    isValidRegistrationNumber(profile.licensedBureauRegistrationNumber) &&
    isValidPersonName(profile.licensedBureauContactName) &&
    isValidPhone(profile.licensedBureauContactPhone) &&
    (!profile.licensedBureauMainPhone || isValidPhone(profile.licensedBureauMainPhone)) &&
    (!profile.licensedBureauContactEmail || isValidEmail(profile.licensedBureauContactEmail))
  );
}

export function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { clientId = '' } = useParams<{ clientId: string }>();
  const path = useClientPath();
  const [profile, setProfile] = useMvpProfile();
  /**
   * The local, per-client signal for "this account has never seen billing".
   * It is wrong for a paying customer adding a second client — which is why
   * the billing subscription is asked first below — but it is the only answer
   * available offline, so it stays as the fallback.
   */
  const isFirstRun = !profile.onboardingCompleted;
  // In-progress answers are restored from the auto-saved draft so leaving a
  // step mid-typing never loses input (the committed profile is the fallback).
  // Everything is restored inside useState initializers — synchronously,
  // before the first paint — so a reload never flashes an unanswered step.
  const [restoredDraft] = useState(() => readMvpOnboardingDraft());
  const [draft, setDraft] = useState(() => restoredDraft?.profile ?? profile);
  const [step, setStep] = useState(() => readSavedStep(clientId));
  const [samePerson, setSamePerson] = useState<Choice>(() => {
    if (restoredDraft?.samePersonChoice) return restoredDraft.samePersonChoice;
    // Legacy drafts predate the stored choice; infer it from the names.
    return draft.recipientName && draft.recipientName === draft.employerName
      ? 'yes'
      : draft.employerName
        ? 'no'
        : '';
  });
  const [helperChoice, setHelperChoice] = useState<Choice>(() => {
    if (restoredDraft?.helperChoice) return restoredDraft.helperChoice;
    return draft.representativeName || draft.representativePhone ? 'yes' : '';
  });
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const checklistComplete = employmentSetupCompletedCount(draft);

  useEffect(() => {
    window.localStorage.setItem(stepStorageKey(clientId), String(step));
  }, [clientId, step]);

  // Retries a legal acceptance a previous visit failed to record (see
  // flushPendingLegalAcceptance above), both on mount and whenever the
  // browser regains connectivity while this page is open.
  useEffect(() => {
    flushPendingLegalAcceptance();
    window.addEventListener('online', flushPendingLegalAcceptance);
    return () => window.removeEventListener('online', flushPendingLegalAcceptance);
  }, []);

  // Debounced draft auto-save: in-progress (possibly invalid) values are kept
  // out of the committed profile but survive leaving the page mid-step.
  useEffect(() => {
    const handle = window.setTimeout(
      () => saveMvpOnboardingDraft(draft, { samePersonChoice: samePerson, helperChoice }),
      DRAFT_SAVE_DELAY_MS,
    );
    return () => window.clearTimeout(handle);
  }, [draft, samePerson, helperChoice]);

  function updateDraft(next: MvpProfile) {
    setDraft(next);
  }

  function updateField<Key extends ProfileStringKey>(key: Key, value: MvpProfile[Key]) {
    const next = {
      ...draft,
      [key]: value,
      ...(key === 'recipientName' && samePerson === 'yes' ? { employerName: value } : {}),
    } as MvpProfile;
    updateDraft(next);
  }

  function touch(key: string) {
    setTouched((current) => new Set(current).add(key));
  }

  function fieldErrorId(key: string) {
    return `${key}-error`;
  }

  function personNameField(
    key: 'recipientName' | 'employerName' | 'caregiverName' | 'representativeName',
    label: string,
  ) {
    const invalid = touched.has(key) && !isValidPersonName(draft[key]);
    return (
      <label>
        {label}
        <input
          value={draft[key]}
          autoComplete="name"
          required
          className={invalid ? 'field-input-error' : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? fieldErrorId(key) : undefined}
          onBlur={() => touch(key)}
          onChange={(event) => updateField(key, event.target.value)}
        />
        {invalid ? (
          <span id={fieldErrorId(key)} className="field-error-message" role="alert">
            {t('onboarding.nameError')}
          </span>
        ) : null}
      </label>
    );
  }

  function phoneField(key: 'employerPhone' | 'representativePhone', label: string) {
    const invalid = touched.has(key) && !isValidPhone(draft[key]);
    return (
      <label>
        {label}
        <input
          type="tel"
          inputMode="tel"
          dir="ltr"
          autoComplete="tel"
          value={draft[key]}
          required
          className={invalid ? 'field-input-error' : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? fieldErrorId(key) : undefined}
          onBlur={() => touch(key)}
          onChange={(event) => updateField(key, event.target.value)}
        />
        {invalid ? (
          <span id={fieldErrorId(key)} className="field-error-message" role="alert">
            {t('onboarding.phoneError')}
          </span>
        ) : null}
      </label>
    );
  }

  const idValidationError = getIsraeliIdValidationError(draft.employerIdNumber);
  const showIdError =
    idValidationError !== null &&
    (touched.has('employerIdNumber') || draft.employerIdNumber.length === 9);
  const idErrorMessage =
    idValidationError === 'characters'
      ? t('profile.employerIdCharactersError')
      : idValidationError === 'length'
        ? t('profile.employerIdLengthError')
        : idValidationError === 'checksum'
          ? t('profile.employerIdChecksumError')
          : t('profile.employerIdRequired');

  const currentValid = (() => {
    switch (step) {
      case 0:
        return isValidPersonName(draft.recipientName);
      case 1:
        return (
          Boolean(samePerson) &&
          isValidPersonName(draft.employerName) &&
          isValidIsraeliId(draft.employerIdNumber) &&
          isValidPhone(draft.employerPhone)
        );
      case 2:
        return (
          isValidPersonName(draft.caregiverName) &&
          Boolean(draft.caregiverCountry) &&
          Boolean(draft.caregiverLanguage) &&
          isValidIsoDate(draft.employmentStartDate)
        );
      case 3:
        return (
          helperChoice === 'no' ||
          (helperChoice === 'yes' &&
            isValidPersonName(draft.representativeName) &&
            isValidPhone(draft.representativePhone))
        );
      case 4:
        return bureauDetailsValid(draft);
      case 5:
        return checklistComplete === 6;
      default:
        return false;
    }
  })();

  const stepTitle = [
    t('onboarding.recipient'),
    t('onboarding.employer'),
    t('onboarding.caregiver'),
    t('onboarding.support'),
    t('onboarding.licensedBureau'),
    t('onboarding.checklist'),
  ][step]!;

  function chooseSamePerson(choice: Exclude<Choice, ''>) {
    setSamePerson(choice);
    const next = {
      ...draft,
      employerName: choice === 'yes' ? draft.recipientName : '',
    };
    updateDraft(next);
    // A radio tap is a discrete answer, not mid-typing: persist it immediately
    // so a reload inside the debounce window still restores the exact choice.
    saveMvpOnboardingDraft(next, { samePersonChoice: choice, helperChoice });
  }

  function chooseHelper(choice: Exclude<Choice, ''>) {
    setHelperChoice(choice);
    const next =
      choice === 'no' ? { ...draft, representativeName: '', representativePhone: '' } : draft;
    if (next !== draft) updateDraft(next);
    saveMvpOnboardingDraft(next, { samePersonChoice: samePerson, helperChoice: choice });
  }

  function commitStep(next: MvpProfile) {
    // When the employer is the care recipient, the ID/phone/address typed on
    // the employer step also answer the recipient fields elsewhere in the app.
    const committed = withSamePersonFallbacks(next);
    setDraft(committed);
    setProfile(committed);
    saveMvpOnboardingDraft(committed, { samePersonChoice: samePerson, helperChoice });
  }

  async function complete() {
    const completed = withSamePersonFallbacks({
      ...draft,
      salaryEffectiveDate: draft.salaryEffectiveDate || draft.employmentStartDate,
      onboardingCompleted: true,
    });
    setDraft(completed);
    setProfile(completed);
    clearMvpOnboardingDraft();
    window.localStorage.removeItem(stepStorageKey(clientId));

    // This is the step code review WEB-11 found missing. Finishing setup is the
    // moment the household becomes a real employment relationship, so it is the
    // moment the canonical `EmploymentCase` is opened — from the details the
    // user just gave, linked to this client
    // (`employment_case.legacy_client_id`, migration 0042). Without it nothing
    // in the product ever created a case and every canonical screen was a dead
    // end.
    //
    // Deliberately not awaited. Setup must finish offline, the call is
    // idempotent per client, and the retry points are OpenCasePage and the
    // emergency binder — so a failure here costs the user nothing and blocking
    // the last click of a six-step wizard on a network request would.
    void ensureCanonicalCase(
      clientId || LEGACY_UNSCOPED_CLIENT_ID,
      t('case.defaultRelationship'),
      completed,
    );

    // Acceptance is recorded here too, and not only at payment.
    //
    // Finishing setup is the moment the caregiver's identity documents, visa
    // data and payroll details start being held - and that happens whether or
    // not the user ever reaches the billing screen, and whether or not they
    // ever pay. Recording consent only at the point of payment would mean the
    // account that matters most for privacy purposes, the one holding a third
    // party's data with no subscription attached, is the one with no record
    // that its holder accepted anything.
    //
    // Not awaited, for the same reason `ensureCanonicalCase` above is not:
    // setup must be able to finish offline, and blocking the last click of a
    // six-step wizard on a network request would cost the user more than the
    // failure does. The recording is idempotent per (user, document, version),
    // so the billing flow - where it IS awaited and IS blocking - re-records it
    // for free if this call was lost.
    //
    // The failure path used to be `.catch(() => undefined)` - a customer who
    // closed the tab right here, before ever reaching billing, left an account
    // holding a third party's identity documents with no record anyone agreed
    // to anything. It cannot become `.catch(writePendingLegalAcceptance)`
    // unconditionally either: a rejection can mean "the network is down" (queue
    // it) or "the server told us this request is malformed" (queuing it would
    // just retry the same failure forever). ApiRequestError with a 4xx status
    // is the latter; anything else - a network failure, a timeout, a 5xx - is
    // queued for flushPendingLegalAcceptance to retry.
    const legalAcceptanceInput: LegalAcceptanceRequest = {
      documents: [
        { document: 'terms', version: TERMS_DOCUMENT_VERSION },
        { document: 'privacy', version: PRIVACY_DOCUMENT_VERSION },
      ],
      context: 'onboarding',
    };
    void recordLegalAcceptance(legalAcceptanceInput).catch((error: unknown) => {
      if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) return;
      writePendingLegalAcceptance(legalAcceptanceInput);
    });

    // "First run" is a property of the ACCOUNT's subscription, not of any one
    // client record. `profile.onboardingCompleted` (useMvpProfile) is scoped
    // to the client id in the path, so completing setup for a SECOND client on
    // an account that already pays used to read as "first run" again and send
    // a paying customer back to /billing. The billing subscription endpoint is
    // account-scoped (no caseId), so its status is what actually answers this.
    //
    // A subscription row exists for every tenant the moment anyone reads it
    // (billing's getOrCreate), so mere existence says nothing - its *status*
    // does: 'payment_method_pending' with no payment method attached is the
    // untouched default of an account that has never engaged billing at all.
    // Anything else (a payment method is on file, or the status has moved past
    // that default) means this account has already engaged billing, and must
    // never be sent back to the payment screen.
    //
    // This must not block onboarding from completing offline, so the request
    // is awaited only for the navigation decision - profile/case/consent are
    // already committed above regardless of its outcome.
    //
    // When the request fails the answer is unknown, and falling through to
    // "not first run" would silently drop the payment prompt for every genuine
    // signup that happened to be offline at that moment - a customer who never
    // sees the billing screen never pays. So an unknown answer falls back to
    // the local signal this screen used before (`isFirstRun`, derived from the
    // client's own setup record). It is the weaker of the two answers, which is
    // why it is the fallback and not the primary.
    let goToBilling = isFirstRun;
    try {
      const plan = await getBillingSubscription();
      goToBilling = plan.paymentMethod === null && plan.status === 'payment_method_pending';
    } catch {
      goToBilling = isFirstRun;
    }
    navigate(goToBilling ? '/billing?from=onboarding' : path('/'));
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
          {t('onboarding.progress', { current: step + 1, total: LAST_STEP + 1 })}
        </span>
      </header>

      <aside className="onboarding-save-status" role="status" aria-live="polite">
        <span aria-hidden="true">✓</span> {t('onboarding.saved')}
      </aside>

      <section className="wizard-card" aria-labelledby="onboarding-step">
        <div className="onboarding-progress" aria-hidden="true">
          {Array.from({ length: LAST_STEP + 1 }, (_, index) => (
            <span key={index} className={index <= step ? 'active' : ''} />
          ))}
        </div>
        <form
          className="wizard-content readable-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!currentValid) return;
            if (step === LAST_STEP) {
              void complete();
            } else {
              commitStep(draft);
              setStep((value) => value + 1);
            }
          }}
        >
          <h2 id="onboarding-step">{stepTitle}</h2>
          <p>
            {t(
              `onboarding.stepIntro.${['recipient', 'employer', 'caregiver', 'support', 'licensedBureau', 'checklist'][step]}`,
            )}
          </p>

          {step === 0 ? (
            <>
              {personNameField('recipientName', t('profile.recipientName'))}
              <AutocompleteField
                label={t('profile.city')}
                value={draft.recipientCity}
                options={israeliLocalities}
                autoComplete="address-level2"
                onChange={(value) => updateField('recipientCity', value)}
              />
            </>
          ) : null}

          {step === 1 ? (
            <>
              <fieldset className="onboarding-choice-group">
                <legend>{t('onboarding.samePersonQuestion')}</legend>
                <label>
                  <input
                    type="radio"
                    name="same-person"
                    checked={samePerson === 'yes'}
                    onChange={() => chooseSamePerson('yes')}
                  />
                  <span>{t('onboarding.samePersonYes')}</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="same-person"
                    checked={samePerson === 'no'}
                    onChange={() => chooseSamePerson('no')}
                  />
                  <span>{t('onboarding.samePersonNo')}</span>
                </label>
              </fieldset>
              {samePerson === 'no' ? (
                personNameField('employerName', t('profile.employerName'))
              ) : samePerson === 'yes' ? (
                <p className="info-box">
                  {t('onboarding.samePersonFilled', { name: draft.recipientName })}
                </p>
              ) : null}
              {samePerson ? (
                <>
                  <label>
                    {t('profile.employerIdNumber')}
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      dir="ltr"
                      value={draft.employerIdNumber}
                      required
                      className={showIdError ? 'field-input-error' : undefined}
                      aria-invalid={showIdError || undefined}
                      aria-describedby={`employer-id-help employer-id-count${showIdError ? ' employer-id-error' : ''}`}
                      onBlur={() => touch('employerIdNumber')}
                      onChange={(event) =>
                        updateField('employerIdNumber', normalizeIsraeliId(event.target.value))
                      }
                    />
                    <small id="employer-id-help">{t('profile.employerIdHelp')}</small>
                    <small id="employer-id-count" aria-live="polite">
                      {t('profile.employerIdCount', { count: draft.employerIdNumber.length })}
                    </small>
                    {showIdError ? (
                      <span id="employer-id-error" className="field-error-message" role="alert">
                        {idErrorMessage}
                      </span>
                    ) : null}
                  </label>
                  {phoneField('employerPhone', t('profile.phone'))}
                </>
              ) : null}
            </>
          ) : null}

          {step === 2 ? (
            <>
              {personNameField('caregiverName', t('profile.caregiverName'))}
              <label>
                {t('profile.caregiverCountry')}
                <select
                  value={draft.caregiverCountry}
                  required
                  className={
                    touched.has('caregiverCountry') && !draft.caregiverCountry
                      ? 'field-input-error'
                      : undefined
                  }
                  aria-invalid={
                    (touched.has('caregiverCountry') && !draft.caregiverCountry) || undefined
                  }
                  aria-describedby={
                    touched.has('caregiverCountry') && !draft.caregiverCountry
                      ? 'caregiver-country-error'
                      : undefined
                  }
                  onBlur={() => touch('caregiverCountry')}
                  onChange={(event) => {
                    const country = event.target.value;
                    updateDraft({
                      ...draft,
                      caregiverCountry: country,
                      caregiverLanguage: languageAfterCountryChange(
                        draft.caregiverCountry,
                        country,
                        draft.caregiverLanguage,
                      ),
                    });
                  }}
                >
                  <option value="">{t('common.select')}</option>
                  {caregiverCountries.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                </select>
                {touched.has('caregiverCountry') && !draft.caregiverCountry ? (
                  <span id="caregiver-country-error" className="field-error-message" role="alert">
                    {t('onboarding.selectError')}
                  </span>
                ) : null}
              </label>
              <label>
                {t('profile.caregiverLanguage')}
                <select
                  value={draft.caregiverLanguage}
                  required
                  className={
                    touched.has('caregiverLanguage') && !draft.caregiverLanguage
                      ? 'field-input-error'
                      : undefined
                  }
                  aria-invalid={
                    (touched.has('caregiverLanguage') && !draft.caregiverLanguage) || undefined
                  }
                  aria-describedby={
                    touched.has('caregiverLanguage') && !draft.caregiverLanguage
                      ? 'caregiver-language-error'
                      : undefined
                  }
                  onBlur={() => touch('caregiverLanguage')}
                  onChange={(event) => updateField('caregiverLanguage', event.target.value)}
                >
                  <option value="">{t('common.select')}</option>
                  {caregiverLanguages.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </select>
                {touched.has('caregiverLanguage') && !draft.caregiverLanguage ? (
                  <span id="caregiver-language-error" className="field-error-message" role="alert">
                    {t('onboarding.selectError')}
                  </span>
                ) : null}
              </label>
              <label>
                {t('profile.startDate')}
                <input
                  type="date"
                  dir="ltr"
                  required
                  value={draft.employmentStartDate}
                  className={
                    touched.has('employmentStartDate') && !isValidIsoDate(draft.employmentStartDate)
                      ? 'field-input-error'
                      : undefined
                  }
                  aria-invalid={
                    (touched.has('employmentStartDate') &&
                      !isValidIsoDate(draft.employmentStartDate)) ||
                    undefined
                  }
                  aria-describedby={
                    touched.has('employmentStartDate') && !isValidIsoDate(draft.employmentStartDate)
                      ? 'employment-start-date-error'
                      : undefined
                  }
                  onBlur={() => touch('employmentStartDate')}
                  onChange={(event) => updateField('employmentStartDate', event.target.value)}
                />
                {touched.has('employmentStartDate') &&
                !isValidIsoDate(draft.employmentStartDate) ? (
                  <span
                    id="employment-start-date-error"
                    className="field-error-message"
                    role="alert"
                  >
                    {t('onboarding.dateError')}
                  </span>
                ) : null}
              </label>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <fieldset className="onboarding-choice-group">
                <legend>{t('onboarding.helperQuestion')}</legend>
                <label>
                  <input
                    type="radio"
                    name="helper"
                    checked={helperChoice === 'yes'}
                    onChange={() => chooseHelper('yes')}
                  />
                  <span>{t('onboarding.helperYes')}</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="helper"
                    checked={helperChoice === 'no'}
                    onChange={() => chooseHelper('no')}
                  />
                  <span>{t('onboarding.helperNo')}</span>
                </label>
              </fieldset>
              {helperChoice === 'yes' ? (
                <>
                  {personNameField('representativeName', t('profile.representativeName'))}
                  {phoneField('representativePhone', t('profile.phone'))}
                  <small>{t('onboarding.helperDisclaimer')}</small>
                </>
              ) : null}
            </>
          ) : null}

          {step === 4 ? (
            <LicensedBureauSelector profile={draft} onChange={updateDraft} required />
          ) : null}

          {step === 5 ? (
            <div className="setup-checklist">
              <label className={draft.employmentAgreementConfirmed ? 'complete' : ''}>
                <input
                  type="checkbox"
                  checked={draft.employmentAgreementConfirmed}
                  onChange={(event) =>
                    updateDraft({ ...draft, employmentAgreementConfirmed: event.target.checked })
                  }
                />
                <span>{t('onboarding.agreementConfirmed')}</span>
              </label>
              <label
                className={
                  draft.medicalInsuranceConfirmed &&
                  isValidIsoDate(draft.medicalInsuranceExpiryDate)
                    ? 'complete'
                    : ''
                }
              >
                <input
                  type="checkbox"
                  checked={draft.medicalInsuranceConfirmed}
                  onChange={(event) =>
                    updateDraft({
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
                    className={
                      touched.has('medicalInsuranceExpiryDate') &&
                      !isValidIsoDate(draft.medicalInsuranceExpiryDate)
                        ? 'field-input-error'
                        : undefined
                    }
                    aria-invalid={
                      (touched.has('medicalInsuranceExpiryDate') &&
                        !isValidIsoDate(draft.medicalInsuranceExpiryDate)) ||
                      undefined
                    }
                    aria-describedby={
                      touched.has('medicalInsuranceExpiryDate') &&
                      !isValidIsoDate(draft.medicalInsuranceExpiryDate)
                        ? 'medical-insurance-expiry-error'
                        : undefined
                    }
                    onBlur={() => touch('medicalInsuranceExpiryDate')}
                    onChange={(event) =>
                      updateField('medicalInsuranceExpiryDate', event.target.value)
                    }
                  />
                  <small>{t('onboarding.medicalInsuranceExpiryHelp')}</small>
                  {touched.has('medicalInsuranceExpiryDate') &&
                  !isValidIsoDate(draft.medicalInsuranceExpiryDate) ? (
                    <span
                      id="medical-insurance-expiry-error"
                      className="field-error-message"
                      role="alert"
                    >
                      {t('onboarding.dateError')}
                    </span>
                  ) : null}
                </label>
              ) : null}
              <label>
                {t('onboarding.baseSalary')}
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  max="1000000"
                  step="0.01"
                  required
                  value={draft.baseSalary ?? ''}
                  className={
                    touched.has('baseSalary') && !isPositiveMoney(draft.baseSalary)
                      ? 'field-input-error'
                      : undefined
                  }
                  aria-invalid={
                    (touched.has('baseSalary') && !isPositiveMoney(draft.baseSalary)) || undefined
                  }
                  aria-describedby={
                    touched.has('baseSalary') && !isPositiveMoney(draft.baseSalary)
                      ? 'base-salary-error'
                      : undefined
                  }
                  onBlur={() => touch('baseSalary')}
                  onChange={(event) =>
                    updateDraft({
                      ...draft,
                      baseSalary: event.target.value ? Number(event.target.value) : null,
                    })
                  }
                />
                {touched.has('baseSalary') && !isPositiveMoney(draft.baseSalary) ? (
                  <span id="base-salary-error" className="field-error-message" role="alert">
                    {t('onboarding.moneyError')}
                  </span>
                ) : null}
              </label>
              <label>
                {t('onboarding.saturdayRate')}
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  max="1000000"
                  step="0.01"
                  required
                  value={draft.saturdayRate ?? ''}
                  className={
                    touched.has('saturdayRate') && !isPositiveMoney(draft.saturdayRate)
                      ? 'field-input-error'
                      : undefined
                  }
                  aria-invalid={
                    (touched.has('saturdayRate') && !isPositiveMoney(draft.saturdayRate)) ||
                    undefined
                  }
                  aria-describedby={
                    touched.has('saturdayRate') && !isPositiveMoney(draft.saturdayRate)
                      ? 'saturday-rate-error'
                      : undefined
                  }
                  onBlur={() => touch('saturdayRate')}
                  onChange={(event) =>
                    updateDraft({
                      ...draft,
                      saturdayRate: event.target.value ? Number(event.target.value) : null,
                    })
                  }
                />
                {touched.has('saturdayRate') && !isPositiveMoney(draft.saturdayRate) ? (
                  <span id="saturday-rate-error" className="field-error-message" role="alert">
                    {t('onboarding.moneyError')}
                  </span>
                ) : null}
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
                  className={
                    touched.has('licenseRenewalDate') && !isValidIsoDate(draft.licenseRenewalDate)
                      ? 'field-input-error'
                      : undefined
                  }
                  aria-invalid={
                    (touched.has('licenseRenewalDate') &&
                      !isValidIsoDate(draft.licenseRenewalDate)) ||
                    undefined
                  }
                  aria-describedby={
                    touched.has('licenseRenewalDate') && !isValidIsoDate(draft.licenseRenewalDate)
                      ? 'license-renewal-date-error'
                      : undefined
                  }
                  onBlur={() => touch('licenseRenewalDate')}
                  onChange={(event) => updateField('licenseRenewalDate', event.target.value)}
                />
                {touched.has('licenseRenewalDate') && !isValidIsoDate(draft.licenseRenewalDate) ? (
                  <span
                    id="license-renewal-date-error"
                    className="field-error-message"
                    role="alert"
                  >
                    {t('onboarding.dateError')}
                  </span>
                ) : null}
              </label>
              <label>
                {t('onboarding.visaRenewalDate')}
                <input
                  type="date"
                  dir="ltr"
                  required
                  value={draft.visaRenewalDate}
                  className={
                    touched.has('visaRenewalDate') && !isValidIsoDate(draft.visaRenewalDate)
                      ? 'field-input-error'
                      : undefined
                  }
                  aria-invalid={
                    (touched.has('visaRenewalDate') && !isValidIsoDate(draft.visaRenewalDate)) ||
                    undefined
                  }
                  aria-describedby={
                    touched.has('visaRenewalDate') && !isValidIsoDate(draft.visaRenewalDate)
                      ? 'visa-renewal-date-error'
                      : undefined
                  }
                  onBlur={() => touch('visaRenewalDate')}
                  onChange={(event) => updateField('visaRenewalDate', event.target.value)}
                />
                {touched.has('visaRenewalDate') && !isValidIsoDate(draft.visaRenewalDate) ? (
                  <span id="visa-renewal-date-error" className="field-error-message" role="alert">
                    {t('onboarding.dateError')}
                  </span>
                ) : null}
              </label>
            </div>
          ) : null}

          {!currentValid ? (
            <p id="onboarding-blocked-help" className="onboarding-blocked-help" role="status">
              {t('onboarding.blockedHelp')}
            </p>
          ) : null}

          {/* Shown on the last step only, next to the button that completes
              setup, because that click is what the acceptance is recorded
              against. Placing it here rather than in a footer follows
              docs/governance/LIABILITY-FRAMING.md placement rule 1: the notice
              belongs beside the thing it qualifies. */}
          {step === LAST_STEP ? (
            <div className="onboarding-legal-consent legal-note">
              <p>
                {t('onboarding.legalConsentPrefix')}{' '}
                <Link to="/terms" target="_blank">
                  {t('onboarding.legalConsentTerms')}
                </Link>{' '}
                {t('onboarding.legalConsentAnd')}{' '}
                <Link to="/privacy" target="_blank">
                  {t('onboarding.legalConsentPrivacy')}
                </Link>
                .
              </p>
              <p>{t('onboarding.legalConsentNote')}</p>
            </div>
          ) : null}

          <div className="wizard-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={step === 0}
              onClick={() => setStep((value) => Math.max(0, value - 1))}
            >
              {t('common.back')}
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={!currentValid}
              aria-describedby={!currentValid ? 'onboarding-blocked-help' : undefined}
            >
              {step === LAST_STEP ? t('onboarding.paymentNext') : t('common.continue')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

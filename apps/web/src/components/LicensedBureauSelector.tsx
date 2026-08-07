import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LICENSED_BUREAU_SOURCE,
  licensedBureaus,
  type LicensedBureau,
} from '../licensed-bureaus.js';
import type { MvpProfile } from '../storage/mvp-storage.js';
import {
  isValidEmail,
  isValidOrganizationName,
  isValidPersonName,
  isValidPhone,
  isValidRegistrationNumber,
} from '../validation/onboarding-fields.js';

const MANUAL_VALUE = '__manual__';
const activeBureaus = licensedBureaus.filter((bureau) => bureau.active);

function firstEmail(value: string): string {
  return value.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] ?? '';
}

function officialBureau(profile: MvpProfile): LicensedBureau | undefined {
  return licensedBureaus.find(
    (bureau) => bureau.registrationNumber === profile.licensedBureauRegistrationNumber,
  );
}

function clearBureau(profile: MvpProfile): MvpProfile {
  return {
    ...profile,
    licensedBureauName: '',
    licensedBureauRegistrationNumber: '',
    licensedBureauContactName: '',
    licensedBureauContactPhone: '',
    licensedBureauContactEmail: '',
    licensedBureauMainPhone: '',
    licensedBureauAddress: '',
  };
}

export interface LicensedBureauSelectorProps {
  profile: MvpProfile;
  onChange: (profile: MvpProfile) => void;
  required?: boolean;
}

export function LicensedBureauSelector({
  profile,
  onChange,
  required = false,
}: LicensedBureauSelectorProps) {
  const { t } = useTranslation();
  const selected = officialBureau(profile);
  const hasCustomValue = Boolean(
    profile.licensedBureauName.trim() || profile.licensedBureauRegistrationNumber.trim(),
  );
  const [manualEntry, setManualEntry] = useState(hasCustomValue && !selected);
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const selectValue = selected
    ? selected.registrationNumber
    : manualEntry || hasCustomValue
      ? MANUAL_VALUE
      : '';
  const manual = selectValue === MANUAL_VALUE;

  function touch(field: string) {
    setTouched((current) => new Set(current).add(field));
  }

  function validationProps(field: string, invalid: boolean) {
    const show = touched.has(field) && invalid;
    return {
      show,
      className: show ? 'field-input-error' : undefined,
      'aria-invalid': show || undefined,
      'aria-describedby': show ? `${field}-error` : undefined,
    };
  }

  function error(field: string, message: string, show: boolean) {
    return show ? (
      <span id={`${field}-error`} className="field-error-message" role="alert">
        {message}
      </span>
    ) : null;
  }

  function choose(value: string) {
    if (!value) {
      setManualEntry(false);
      onChange(clearBureau(profile));
      return;
    }
    if (value === MANUAL_VALUE) {
      setManualEntry(true);
      onChange(selected ? clearBureau(profile) : profile);
      return;
    }
    const bureau = activeBureaus.find((item) => item.registrationNumber === value);
    if (!bureau) return;
    setManualEntry(false);
    onChange({
      ...profile,
      licensedBureauName: bureau.name,
      licensedBureauRegistrationNumber: bureau.registrationNumber,
      licensedBureauContactName: bureau.managerName,
      licensedBureauContactPhone: bureau.managerPhone || bureau.phone,
      licensedBureauContactEmail: firstEmail(bureau.email),
      licensedBureauMainPhone: bureau.phone,
      licensedBureauAddress: bureau.addresses.join(' · '),
    });
  }

  return (
    <div className="licensed-bureau-selector">
      <div className="licensed-bureau-select-field">
        <label htmlFor="licensed-bureau-select">{t('licensedBureau.choose')}</label>
        <select
          id="licensed-bureau-select"
          value={selectValue}
          required={required}
          className={
            touched.has('licensed-bureau-select') && required && !selectValue
              ? 'field-input-error'
              : undefined
          }
          aria-invalid={
            (touched.has('licensed-bureau-select') && required && !selectValue) || undefined
          }
          aria-describedby={`licensed-bureau-select-help${
            touched.has('licensed-bureau-select') && required && !selectValue
              ? ' licensed-bureau-select-error'
              : ''
          }`}
          onBlur={() => touch('licensed-bureau-select')}
          onChange={(event) => choose(event.target.value)}
        >
          <option value="">{t('licensedBureau.placeholder')}</option>
          {activeBureaus.map((bureau) => (
            <option key={bureau.id} value={bureau.registrationNumber}>
              {bureau.name} · ח.פ. {bureau.registrationNumber}
            </option>
          ))}
          <option value={MANUAL_VALUE}>{t('licensedBureau.manualOption')}</option>
        </select>
        <small id="licensed-bureau-select-help">
          {t('licensedBureau.selectionHelp', { count: activeBureaus.length })}
        </small>
        {error(
          'licensed-bureau-select',
          t('licensedBureau.validation.selection'),
          touched.has('licensed-bureau-select') && required && !selectValue,
        )}
      </div>

      {selected ? (
        <div className="licensed-bureau-summary" aria-live="polite">
          <div className="licensed-bureau-summary-heading">
            <div>
              <small>{t('licensedBureau.selected')}</small>
              <strong>{selected.name}</strong>
            </div>
            <span aria-hidden="true">✓</span>
          </div>
          <dl>
            <div>
              <dt>{t('profile.licensedBureauRegistrationNumber')}</dt>
              <dd dir="ltr">{selected.registrationNumber}</dd>
            </div>
            <div>
              <dt>{t('licensedBureau.mainPhone')}</dt>
              <dd dir="ltr">{selected.phone}</dd>
            </div>
            <div>
              <dt>{t('licensedBureau.manager')}</dt>
              <dd>{selected.managerName}</dd>
            </div>
            <div>
              <dt>{t('licensedBureau.addresses')}</dt>
              <dd>{selected.addresses.join(' · ')}</dd>
            </div>
          </dl>
          <p>{t('licensedBureau.autofillNote')}</p>
        </div>
      ) : null}

      {manual ? (
        <div className="form-grid two-columns licensed-bureau-manual">
          <label>
            {t('profile.licensedBureauName')}
            {(() => {
              const validation = validationProps(
                'licensed-bureau-name',
                !isValidOrganizationName(profile.licensedBureauName),
              );
              return (
                <>
                  <input
                    value={profile.licensedBureauName}
                    required={required}
                    className={validation.className}
                    aria-invalid={validation['aria-invalid']}
                    aria-describedby={validation['aria-describedby']}
                    onBlur={() => touch('licensed-bureau-name')}
                    onChange={(event) =>
                      onChange({ ...profile, licensedBureauName: event.target.value })
                    }
                  />
                  {error(
                    'licensed-bureau-name',
                    t('licensedBureau.validation.name'),
                    validation.show,
                  )}
                </>
              );
            })()}
          </label>
          <label>
            {t('profile.licensedBureauRegistrationNumber')}
            {(() => {
              const validation = validationProps(
                'licensed-bureau-registration',
                !isValidRegistrationNumber(profile.licensedBureauRegistrationNumber),
              );
              return (
                <>
                  <input
                    dir="ltr"
                    value={profile.licensedBureauRegistrationNumber}
                    required={required}
                    className={validation.className}
                    aria-invalid={validation['aria-invalid']}
                    aria-describedby={validation['aria-describedby']}
                    onBlur={() => touch('licensed-bureau-registration')}
                    onChange={(event) =>
                      onChange({ ...profile, licensedBureauRegistrationNumber: event.target.value })
                    }
                  />
                  {error(
                    'licensed-bureau-registration',
                    t('licensedBureau.validation.registration'),
                    validation.show,
                  )}
                </>
              );
            })()}
          </label>
          <label>
            {t('licensedBureau.mainPhone')}
            {(() => {
              const validation = validationProps(
                'licensed-bureau-main-phone',
                Boolean(profile.licensedBureauMainPhone) &&
                  !isValidPhone(profile.licensedBureauMainPhone),
              );
              return (
                <>
                  <input
                    dir="ltr"
                    type="tel"
                    inputMode="tel"
                    value={profile.licensedBureauMainPhone}
                    className={validation.className}
                    aria-invalid={validation['aria-invalid']}
                    aria-describedby={validation['aria-describedby']}
                    onBlur={() => touch('licensed-bureau-main-phone')}
                    onChange={(event) =>
                      onChange({ ...profile, licensedBureauMainPhone: event.target.value })
                    }
                  />
                  {error(
                    'licensed-bureau-main-phone',
                    t('licensedBureau.validation.phone'),
                    validation.show,
                  )}
                </>
              );
            })()}
          </label>
          <label>
            {t('licensedBureau.addresses')}
            <input
              value={profile.licensedBureauAddress}
              onChange={(event) =>
                onChange({ ...profile, licensedBureauAddress: event.target.value })
              }
            />
          </label>
        </div>
      ) : null}

      {selectValue ? (
        <div className="form-grid two-columns licensed-bureau-contact">
          <label>
            {t('profile.licensedBureauContactName')}
            {(() => {
              const validation = validationProps(
                'licensed-bureau-contact-name',
                !isValidPersonName(profile.licensedBureauContactName),
              );
              return (
                <>
                  <input
                    value={profile.licensedBureauContactName}
                    required={required}
                    className={validation.className}
                    aria-invalid={validation['aria-invalid']}
                    aria-describedby={validation['aria-describedby']}
                    onBlur={() => touch('licensed-bureau-contact-name')}
                    onChange={(event) =>
                      onChange({ ...profile, licensedBureauContactName: event.target.value })
                    }
                  />
                  {error(
                    'licensed-bureau-contact-name',
                    t('licensedBureau.validation.contactName'),
                    validation.show,
                  )}
                </>
              );
            })()}
          </label>
          <label>
            {t('profile.licensedBureauContactPhone')}
            {(() => {
              const validation = validationProps(
                'licensed-bureau-contact-phone',
                !isValidPhone(profile.licensedBureauContactPhone),
              );
              return (
                <>
                  <input
                    dir="ltr"
                    type="tel"
                    inputMode="tel"
                    value={profile.licensedBureauContactPhone}
                    required={required}
                    className={validation.className}
                    aria-invalid={validation['aria-invalid']}
                    aria-describedby={validation['aria-describedby']}
                    onBlur={() => touch('licensed-bureau-contact-phone')}
                    onChange={(event) =>
                      onChange({ ...profile, licensedBureauContactPhone: event.target.value })
                    }
                  />
                  {error(
                    'licensed-bureau-contact-phone',
                    t('licensedBureau.validation.phone'),
                    validation.show,
                  )}
                </>
              );
            })()}
          </label>
          <label className="full-width">
            {t('profile.licensedBureauContactEmail')}
            {(() => {
              const validation = validationProps(
                'licensed-bureau-contact-email',
                Boolean(profile.licensedBureauContactEmail) &&
                  !isValidEmail(profile.licensedBureauContactEmail),
              );
              return (
                <>
                  <input
                    dir="ltr"
                    type="email"
                    value={profile.licensedBureauContactEmail}
                    className={validation.className}
                    aria-invalid={validation['aria-invalid']}
                    aria-describedby={validation['aria-describedby']}
                    onBlur={() => touch('licensed-bureau-contact-email')}
                    onChange={(event) =>
                      onChange({ ...profile, licensedBureauContactEmail: event.target.value })
                    }
                  />
                  {error(
                    'licensed-bureau-contact-email',
                    t('licensedBureau.validation.email'),
                    validation.show,
                  )}
                </>
              );
            })()}
          </label>
        </div>
      ) : null}

      <p className="licensed-bureau-source">
        {t('licensedBureau.sourceNote', { date: '16.2.2026' })}{' '}
        <a href={LICENSED_BUREAU_SOURCE.pageUrl} target="_blank" rel="noreferrer">
          {t('licensedBureau.sourceLink')}
        </a>
      </p>
    </div>
  );
}

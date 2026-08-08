/* eslint-disable no-restricted-syntax */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useClientPath } from '../hooks/use-client-path.js';
import {
  caregiverCountries,
  caregiverLanguages,
  languageAfterCountryChange,
} from '../caregiver-options.js';
import { useMvpProfile } from '../hooks/use-mvp-profile.js';

export function EmployeePage() {
  const path = useClientPath();
  const [profile, setProfile] = useMvpProfile();
  const [draft, setDraft] = useState(profile);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const initials = profile.caregiverName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  function startEditing() {
    setDraft(profile);
    setSaved(false);
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(profile);
    setEditing(false);
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">מטפל או מטפלת</p>
          <h1>{profile.caregiverName || 'טרם הוזן שם'}</h1>
          <p>פרטי ההעסקה והתקשורת שנשמרו במערכת.</p>
        </div>
        <Link className="primary-button" to={path('/trust')}>
          מסרים לבניית אמון
        </Link>
      </header>

      <section className="profile-card">
        <div className="large-avatar">{initials || '–'}</div>
        <div>
          <h2>{profile.caregiverName || 'טרם הוזן'}</h2>
          <p>
            {profile.caregiverCountry || 'ארץ מוצא טרם הוגדרה'} · תחילת העסקה{' '}
            {profile.employmentStartDate || 'טרם הוגדרה'}
          </p>
          <div className="mini-facts">
            <span>שפה מועדפת: {profile.caregiverLanguage || 'טרם הוגדרה'}</span>
          </div>
        </div>
        <button className="secondary-button" type="button" onClick={startEditing}>
          עריכת פרטים
        </button>
      </section>

      {editing ? (
        <form
          className="card readable-form"
          onSubmit={(event) => {
            event.preventDefault();
            setProfile(draft);
            setEditing(false);
            setSaved(true);
          }}
        >
          <h2>עריכת פרטי המטפל</h2>
          <label>
            שם המטפל או המטפלת
            <input
              required
              value={draft.caregiverName}
              onChange={(event) => setDraft({ ...draft, caregiverName: event.target.value })}
            />
          </label>
          <label>
            ארץ מוצא
            <select
              required
              value={draft.caregiverCountry}
              onChange={(event) => {
                const country = event.target.value;
                setDraft({
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
              <option value="">בחירה</option>
              {caregiverCountries.map((country) => (
                <option key={country}>{country}</option>
              ))}
            </select>
          </label>
          <label>
            שפה מועדפת
            <select
              required
              value={draft.caregiverLanguage}
              onChange={(event) => setDraft({ ...draft, caregiverLanguage: event.target.value })}
            >
              <option value="">בחירה</option>
              {caregiverLanguages.map((language) => (
                <option key={language}>{language}</option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button className="primary-button" type="submit">
              שמירת הפרטים
            </button>
            <button className="secondary-button" type="button" onClick={cancelEditing}>
              ביטול
            </button>
          </div>
        </form>
      ) : null}
      {saved ? (
        <p className="info-box" role="status">
          פרטי המטפל נשמרו.
        </p>
      ) : null}

      <section className="card trust-preview">
        <div>
          <p className="eyebrow">קשר ותקשורת</p>
          <h2>שיחה קטנה יכולה לבנות אמון גדול</h2>
          <p>מסרים קצרים ומכבדים בשפה המועדפת של המטפל מסייעים בתיאום ציפיות ובתחושת שותפות.</p>
        </div>
        <Link className="secondary-button" to={path('/trust')}>
          לפתיחת המסרים
        </Link>
      </section>
    </div>
  );
}

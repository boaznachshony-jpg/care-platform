import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MEDICATION_TIMES,
  readMvpMedications,
  saveMvpMedications,
  type MvpMedication,
  type MvpMedicationTime,
} from '../storage/mvp-storage.js';
import { formatDateTime, toIsoAttribute } from '../format-timestamp.js';

/**
 * Standing medications, kept for handover.
 *
 * The whole point of this screen is the moment someone new takes over - a
 * replacement caregiver, a family member covering a weekend, a paramedic
 * reading the emergency binder. That is why the list is optimised for being
 * read under pressure rather than for data entry: name and dosage first, the
 * times of day as words, and the prescribing doctor beside each entry so the
 * reader knows who to call rather than having to guess.
 *
 * It records what the family already knows. It does not advise.
 */
function emptyDraft(): Omit<MvpMedication, 'id' | 'updatedAt'> {
  return { name: '', dosage: '', timesOfDay: [], daily: true, prescribingDoctor: '', notes: '' };
}

export function MedicationsPage() {
  const { t } = useTranslation();
  const [medications, setMedications] = useState<MvpMedication[]>(() => readMvpMedications());
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function persist(next: MvpMedication[]): void {
    setMedications(next);
    saveMvpMedications(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  function toggleTime(time: MvpMedicationTime): void {
    setDraft((current) => ({
      ...current,
      timesOfDay: current.timesOfDay.includes(time)
        ? current.timesOfDay.filter((item) => item !== time)
        : [...current.timesOfDay, time],
    }));
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (!draft.name.trim()) return;
    const now = new Date().toISOString();
    if (editingId) {
      persist(
        medications.map((item) =>
          item.id === editingId ? { ...item, ...draft, updatedAt: now } : item,
        ),
      );
    } else {
      persist([...medications, { ...draft, id: crypto.randomUUID(), updatedAt: now }]);
    }
    setDraft(emptyDraft());
    setEditingId(null);
  }

  function edit(medication: MvpMedication): void {
    setEditingId(medication.id);
    setDraft({
      name: medication.name,
      dosage: medication.dosage,
      timesOfDay: medication.timesOfDay,
      daily: medication.daily,
      prescribingDoctor: medication.prescribingDoctor,
      notes: medication.notes,
    });
  }

  function remove(id: string): void {
    if (!window.confirm(t('medications.removeConfirm'))) return;
    persist(medications.filter((item) => item.id !== id));
    if (editingId === id) {
      setEditingId(null);
      setDraft(emptyDraft());
    }
  }

  return (
    <div className="readable-form medications-page">
      <p className="eyebrow">{t('medications.eyebrow')}</p>
      <h1>{t('medications.title')}</h1>
      <p>{t('medications.intro')}</p>

      {/* Stated before anything can be entered, not buried under the form:
          this is a record the client owns, not a clinical instruction. */}
      <p className="action-notice error medications-disclaimer" role="note">
        {t('medications.disclaimer')}
      </p>

      <section aria-labelledby="medications-list-title">
        <h2 id="medications-list-title">{t('medications.listTitle')}</h2>
        {medications.length === 0 ? (
          <p className="success-box">{t('medications.empty')}</p>
        ) : (
          <ul className="detail-list medications-list" aria-label={t('medications.listTitle')}>
            {medications.map((medication) => (
              <li key={medication.id}>
                <span>
                  <strong>{medication.name}</strong>
                  <small>
                    {medication.dosage ? `${medication.dosage} · ` : ''}
                    {medication.daily ? t('medications.daily') : t('medications.notDaily')}
                    {medication.timesOfDay.length > 0
                      ? ` · ${medication.timesOfDay.map((time) => t(`medications.time.${time}`)).join(', ')}`
                      : ` · ${t('medications.asNeeded')}`}
                  </small>
                  {medication.prescribingDoctor ? (
                    <small>
                      {t('medications.doctor')}: {medication.prescribingDoctor}
                    </small>
                  ) : null}
                  {medication.notes ? <small>{medication.notes}</small> : null}
                  {toIsoAttribute(medication.updatedAt) ? (
                    <small className="record-timestamp">
                      {t('medications.updatedAt')}{' '}
                      <time dateTime={toIsoAttribute(medication.updatedAt) ?? undefined}>
                        {formatDateTime(medication.updatedAt)}
                      </time>
                    </small>
                  ) : null}
                </span>
                <button className="secondary-button" type="button" onClick={() => edit(medication)}>
                  {t('medications.edit')}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => remove(medication.id)}
                >
                  {t('medications.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={submit} aria-labelledby="medications-form-title">
        <h2 id="medications-form-title">
          {editingId ? t('medications.editTitle') : t('medications.addTitle')}
        </h2>
        <div className="form-grid">
          <label>
            {t('medications.name')}
            <input
              value={draft.name}
              required
              onChange={(event) => setDraft((c) => ({ ...c, name: event.target.value }))}
            />
          </label>
          <label>
            {t('medications.dosage')}
            <input
              value={draft.dosage}
              placeholder={t('medications.dosagePlaceholder')}
              onChange={(event) => setDraft((c) => ({ ...c, dosage: event.target.value }))}
            />
          </label>
          <label>
            {t('medications.doctor')}
            <input
              value={draft.prescribingDoctor}
              onChange={(event) =>
                setDraft((c) => ({ ...c, prescribingDoctor: event.target.value }))
              }
            />
          </label>
        </div>

        <fieldset className="medications-times">
          <legend>{t('medications.timesLegend')}</legend>
          {MEDICATION_TIMES.map((time) => (
            <label key={time}>
              <input
                type="checkbox"
                checked={draft.timesOfDay.includes(time)}
                onChange={() => toggleTime(time)}
              />
              {t(`medications.time.${time}`)}
            </label>
          ))}
          <small>{t('medications.timesHint')}</small>
        </fieldset>

        <label className="medications-daily">
          <input
            type="checkbox"
            checked={draft.daily}
            onChange={(event) => setDraft((c) => ({ ...c, daily: event.target.checked }))}
          />
          {t('medications.dailyLabel')}
        </label>

        <label>
          {t('medications.notes')}
          <textarea
            value={draft.notes}
            placeholder={t('medications.notesPlaceholder')}
            onChange={(event) => setDraft((c) => ({ ...c, notes: event.target.value }))}
          />
        </label>

        <button className="primary-button" type="submit">
          {editingId ? t('medications.save') : t('medications.add')}
        </button>
        {editingId ? (
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setEditingId(null);
              setDraft(emptyDraft());
            }}
          >
            {t('medications.cancelEdit')}
          </button>
        ) : null}
        {saved ? <p className="success-box">{t('medications.savedNotice')}</p> : null}
      </form>

      <p className="report-footnote">
        <span aria-hidden="true">*</span> {t('medications.footnote')}
      </p>
    </div>
  );
}

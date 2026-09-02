import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MEDICATION_DAYS,
  MEDICATION_TIMES,
  readMvpMedications,
  saveMvpMedications,
  type MvpMedication,
  type MvpMedicationDay,
  type MvpMedicationTime,
} from '../storage/mvp-storage.js';
import { formatDateTime, toIsoAttribute } from '../format-timestamp.js';
import { ReminderRecipientsSection } from '../components/ReminderRecipientsSection.js';
import { archiveCaseMedication, importCaseMedication, listCaseMedications } from '../api/client.js';
import { useLegacyClientId } from '../hooks/use-legacy-client-id.js';
import { useCaseForLegacyClient } from '../sync/use-case-for-legacy-client.js';
import {
  getUploadedServerId,
  rememberUploadedServerId,
  uploadUnsyncedRecords,
  type SyncStatus,
} from '../sync/legacy-upload.js';
import { medicationResponseToLocal } from '../sync/medication-mapping.js';

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
  return {
    name: '',
    dosage: '',
    timesOfDay: [],
    daily: true,
    daysOfWeek: [],
    prescribingDoctor: '',
    notes: '',
  };
}

export function MedicationsPage() {
  const { t } = useTranslation();
  const [medications, setMedications] = useState<MvpMedication[]>(() => readMvpMedications());
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Medications are the record an emergency binder is read for on someone
  // else's device — see EmergencyBinderPage.tsx. Getting them onto the
  // server is the whole point of this cutover for this screen specifically,
  // more than for tasks or documents.
  const legacyClientId = useLegacyClientId();
  const caseLookup = useCaseForLegacyClient(legacyClientId);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ phase: 'checking' });
  const [syncAttempt, setSyncAttempt] = useState(0);

  useEffect(() => {
    if (caseLookup.status !== 'found') {
      setSyncStatus(
        caseLookup.status === 'checking' ? { phase: 'checking' } : { phase: 'no-case' },
      );
      return;
    }
    const caseId = caseLookup.caseId;
    let active = true;

    async function run() {
      const localNow = readMvpMedications();
      const outcome = await uploadUnsyncedRecords('medications', caseId, localNow, (medication) =>
        importCaseMedication(caseId, {
          legacyLocalId: medication.id,
          name: medication.name,
          dosage: medication.dosage,
          timesOfDay: medication.timesOfDay,
          daily: medication.daily,
          daysOfWeek: medication.daysOfWeek ?? undefined,
          prescribingDoctor: medication.prescribingDoctor,
          notes: medication.notes,
        }),
      );
      if (!active) return;
      if (outcome.failedIds.length > 0) {
        setSyncStatus({ phase: 'upload-failed', failedCount: outcome.failedIds.length });
        return;
      }

      try {
        const serverMedications = await listCaseMedications(caseId);
        if (!active) return;
        const byLocalId = new Map(
          serverMedications
            .filter((medication) => medication.legacyLocalId)
            .map((medication) => [medication.legacyLocalId as string, medication] as const),
        );
        const merged = readMvpMedications().map((medication) => {
          const match = byLocalId.get(medication.id);
          return match
            ? { ...medicationResponseToLocal(match), updatedAt: medication.updatedAt }
            : medication;
        });
        for (const serverMedication of serverMedications) {
          if (serverMedication.legacyLocalId) continue;
          if (merged.some((medication) => medication.id === serverMedication.id)) continue;
          rememberUploadedServerId('medications', caseId, serverMedication.id, serverMedication.id);
          merged.push(medicationResponseToLocal(serverMedication));
        }
        saveMvpMedications(merged);
        setMedications(merged);
        setSyncStatus({ phase: 'synced' });
      } catch {
        setSyncStatus({ phase: 'offline' });
      }
    }

    void run();
    return () => {
      active = false;
    };
  }, [caseLookup, syncAttempt]);

  function persist(next: MvpMedication[]): void {
    setMedications(next);
    saveMvpMedications(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
    if (caseLookup.status === 'found') setSyncAttempt((count) => count + 1);
  }

  function toggleTime(time: MvpMedicationTime): void {
    setDraft((current) => ({
      ...current,
      timesOfDay: current.timesOfDay.includes(time)
        ? current.timesOfDay.filter((item) => item !== time)
        : [...current.timesOfDay, time],
    }));
  }

  function toggleDay(day: MvpMedicationDay): void {
    setDraft((current) => {
      const days = current.daysOfWeek ?? [];
      return {
        ...current,
        daysOfWeek: days.includes(day)
          ? days.filter((item) => item !== day)
          : // Stored in the canonical Sunday-first order rather than in tick
            // order, so the record reads the way the week is spoken.
            MEDICATION_DAYS.filter((item) => item === day || days.includes(item)),
      };
    });
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
      // A record saved before the day picker existed has no list at all. It
      // opens with nothing ticked and the form says plainly that no reminder
      // goes out until days are chosen - which is what it was already doing.
      daysOfWeek: medication.daysOfWeek ?? [],
      prescribingDoctor: medication.prescribingDoctor,
      notes: medication.notes,
    });
  }

  function remove(id: string): void {
    if (!window.confirm(t('medications.removeConfirm'))) return;
    // Local delete only, as before. Server side is soft-closed (archived,
    // never deleted — see database/migrations/0046), so a stand-in reading
    // an already-printed or previously-synced binder on another device is
    // never left with a medication that silently vanished.
    if (caseLookup.status === 'found') {
      const serverId = getUploadedServerId('medications', caseLookup.caseId, id);
      if (serverId) void archiveCaseMedication(caseLookup.caseId, serverId).catch(() => undefined);
    }
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

      {/*
        Honest data-source labelling — see the matching comment in
        TasksPage.tsx §2. Deliberately role="status", not role="note": the
        disclaimer above is the only element on this page allowed that role
        (MedicationsPage.test.tsx asserts there is exactly one).
      */}
      {syncStatus.phase === 'offline' ? (
        <p className="info-box" role="status">
          {t('medications.sync.localCopy')}
        </p>
      ) : syncStatus.phase === 'upload-failed' ? (
        <p className="action-notice error" role="status">
          {t('medications.sync.uploadFailed', { count: syncStatus.failedCount })}{' '}
          <button
            className="text-link"
            type="button"
            onClick={() => setSyncAttempt((count) => count + 1)}
          >
            {t('medications.sync.retry')}
          </button>
        </p>
      ) : null}

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
                    {!medication.daily && (medication.daysOfWeek?.length ?? 0) > 0
                      ? ` (${MEDICATION_DAYS.filter((day) => medication.daysOfWeek?.includes(day))
                          .map((day) => t(`medications.day.${day}`))
                          .join(', ')})`
                      : ''}
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

        {/* Only asked when it matters. A medication taken every day has no day
            list to fill in, and showing seven empty checkboxes under "taken
            every day" invites someone to tick three of them and quietly halve
            their own reminders. */}
        {draft.daily ? null : (
          <fieldset className="medications-times">
            <legend>{t('medications.daysLegend')}</legend>
            {MEDICATION_DAYS.map((day) => (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={(draft.daysOfWeek ?? []).includes(day)}
                  onChange={() => toggleDay(day)}
                />
                {t(`medications.day.${day}`)}
              </label>
            ))}
            <small>{t('medications.daysHint')}</small>
          </fieldset>
        )}

        {/* Said on the screen, not only in the scheduler's log. The failure this
            product exists to prevent is the reminder nobody knew was missing,
            so the one state that sends nothing has to announce itself.
            Deliberately not role="note": the medical disclaimer above owns that
            role on this page, and a second one would make it unfindable. */}
        {!draft.daily && (draft.daysOfWeek ?? []).length === 0 ? (
          <p className="action-notice error medications-days-missing">
            {t('medications.daysMissing')}
          </p>
        ) : null}

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

      {/* Kept on the same screen as the medication list on purpose: the person
          deciding who to tell is the person who just wrote down what is taken
          and when, and separating the two invites a list with no recipients. */}
      <ReminderRecipientsSection />

      <p className="report-footnote">
        <span aria-hidden="true">*</span> {t('medications.footnote')}
      </p>
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  canReceiveReminders,
  readMvpReminderRecipients,
  reminderContactFor,
  saveMvpReminderRecipients,
  REMINDER_CHANNELS,
  type MvpReminderChannel,
  type MvpReminderRecipient,
} from '../storage/mvp-storage.js';
import { formatDateTime, toIsoAttribute } from '../format-timestamp.js';

/**
 * The recipient list behind medication reminders.
 *
 * Two decisions are load-bearing and are the reason this is a separate,
 * explicit screen rather than a settings toggle:
 *
 * The channel belongs to the recipient. A family member abroad on an eSIM data
 * plan has internet but no cellular line, so an SMS to them is accepted by the
 * network and never arrives - and nobody finds out. One account-wide channel
 * would fail exactly the person the household relies on, silently.
 *
 * Consent is per recipient. A reminder about someone's medication is health
 * information about a third party, so agreement is recorded against each
 * person and is the gate every send has to pass. The status column states
 * plainly who will and will not be contacted, because a reminder system that
 * quietly drops people is worse than none.
 */
function emptyDraft(): Omit<MvpReminderRecipient, 'id' | 'updatedAt'> {
  return {
    name: '',
    relationship: '',
    phone: '',
    email: '',
    channel: 'sms',
    consentAt: '',
    consentBy: '',
    active: true,
  };
}

export function ReminderRecipientsSection({ recordedBy = '' }: { recordedBy?: string }) {
  const { t } = useTranslation();
  const [recipients, setRecipients] = useState<MvpReminderRecipient[]>(() =>
    readMvpReminderRecipients(),
  );
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function persist(next: MvpReminderRecipient[]): void {
    setRecipients(next);
    saveMvpReminderRecipients(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  /**
   * Says why someone will not be contacted, rather than only that they will.
   * "Waiting for their agreement" is actionable; a missing row is not.
   */
  function statusOf(recipient: MvpReminderRecipient): string {
    if (canReceiveReminders(recipient)) return t('reminderRecipients.statusReady');
    if (!recipient.active) return t('reminderRecipients.statusPaused');
    if (recipient.consentAt.trim() === '') return t('reminderRecipients.statusNoConsent');
    return t('reminderRecipients.statusNoContact');
  }

  function toggleConsent(checked: boolean): void {
    setDraft((current) => ({
      ...current,
      // Recording the moment of consent, not merely a boolean, is what makes
      // the record auditable a year later.
      consentAt: checked ? new Date().toISOString() : '',
      consentBy: checked ? recordedBy : '',
    }));
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!draft.name.trim()) return;
    const now = new Date().toISOString();
    if (editingId) {
      persist(
        recipients.map((item) =>
          item.id === editingId ? { ...item, ...draft, updatedAt: now } : item,
        ),
      );
    } else {
      persist([...recipients, { ...draft, id: crypto.randomUUID(), updatedAt: now }]);
    }
    setDraft(emptyDraft());
    setEditingId(null);
  }

  function edit(recipient: MvpReminderRecipient): void {
    setEditingId(recipient.id);
    const { id: _id, updatedAt: _updatedAt, ...rest } = recipient;
    setDraft(rest);
  }

  function remove(id: string): void {
    if (!window.confirm(t('reminderRecipients.removeConfirm'))) return;
    persist(recipients.filter((item) => item.id !== id));
    if (editingId === id) {
      setEditingId(null);
      setDraft(emptyDraft());
    }
  }

  return (
    <section className="reminder-recipients" aria-labelledby="reminder-recipients-title">
      <h2 id="reminder-recipients-title">{t('reminderRecipients.title')}</h2>
      <p>{t('reminderRecipients.intro')}</p>

      {/* Deliberately not role="note". The medical disclaimer on this page is
          the one advisory a screen reader must announce as its own landmark
          before any data is entered, and a second note competing with it
          weakens exactly the warning that matters most. This paragraph sits
          inside a labelled section, so it is already read in context. */}
      <p className="action-notice error">{t('reminderRecipients.privacyNotice')}</p>

      <h3>{t('reminderRecipients.listTitle')}</h3>
      {recipients.length === 0 ? (
        <p className="success-box">{t('reminderRecipients.empty')}</p>
      ) : (
        <ul className="detail-list" aria-label={t('reminderRecipients.listTitle')}>
          {recipients.map((recipient) => (
            <li key={recipient.id}>
              <span>
                <strong>{recipient.name}</strong>
                <small>
                  {recipient.relationship ? `${recipient.relationship} · ` : ''}
                  {t(`reminderRecipients.channel.${recipient.channel}`)}
                  {reminderContactFor(recipient) ? ` · ${reminderContactFor(recipient)}` : ''}
                </small>
                <small
                  className="reminder-recipient-status"
                  data-ready={canReceiveReminders(recipient) ? 'true' : 'false'}
                >
                  {statusOf(recipient)}
                </small>
                {toIsoAttribute(recipient.updatedAt) ? (
                  <small className="record-timestamp">
                    {t('reminderRecipients.updatedAt')}{' '}
                    <time dateTime={toIsoAttribute(recipient.updatedAt) ?? undefined}>
                      {formatDateTime(recipient.updatedAt)}
                    </time>
                  </small>
                ) : null}
              </span>
              <button className="secondary-button" type="button" onClick={() => edit(recipient)}>
                {t('reminderRecipients.edit')}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => remove(recipient.id)}
              >
                {t('reminderRecipients.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} aria-labelledby="reminder-recipients-form-title">
        <h3 id="reminder-recipients-form-title">
          {editingId ? t('reminderRecipients.editTitle') : t('reminderRecipients.addTitle')}
        </h3>
        <div className="form-grid">
          <label>
            {t('reminderRecipients.name')}
            <input
              value={draft.name}
              required
              onChange={(event) => setDraft((c) => ({ ...c, name: event.target.value }))}
            />
          </label>
          <label>
            {t('reminderRecipients.relationship')}
            <input
              value={draft.relationship}
              placeholder={t('reminderRecipients.relationshipPlaceholder')}
              onChange={(event) => setDraft((c) => ({ ...c, relationship: event.target.value }))}
            />
          </label>
          <label>
            {t('reminderRecipients.phone')}
            <input
              dir="ltr"
              type="tel"
              value={draft.phone}
              placeholder={t('reminderRecipients.phonePlaceholder')}
              onChange={(event) => setDraft((c) => ({ ...c, phone: event.target.value }))}
            />
          </label>
          <label>
            {t('reminderRecipients.email')}
            <input
              dir="ltr"
              type="email"
              value={draft.email}
              onChange={(event) => setDraft((c) => ({ ...c, email: event.target.value }))}
            />
          </label>
        </div>

        <fieldset className="reminder-channels">
          <legend>{t('reminderRecipients.channelLegend')}</legend>
          {REMINDER_CHANNELS.map((channel) => (
            <label key={channel}>
              <input
                type="radio"
                name="reminder-channel"
                value={channel}
                checked={draft.channel === channel}
                onChange={() => setDraft((c) => ({ ...c, channel: channel as MvpReminderChannel }))}
              />
              {t(`reminderRecipients.channel.${channel}`)}
            </label>
          ))}
          <small>{t('reminderRecipients.channelHint')}</small>
        </fieldset>

        <label className="reminder-consent">
          <input
            type="checkbox"
            checked={draft.consentAt !== ''}
            onChange={(event) => toggleConsent(event.target.checked)}
          />
          {t('reminderRecipients.consentLabel')}
        </label>
        <small>{t('reminderRecipients.consentHint')}</small>

        <label className="reminder-active">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(event) => setDraft((c) => ({ ...c, active: event.target.checked }))}
          />
          {t('reminderRecipients.activeLabel')}
        </label>

        <button className="primary-button" type="submit">
          {editingId ? t('reminderRecipients.save') : t('reminderRecipients.add')}
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
            {t('reminderRecipients.cancelEdit')}
          </button>
        ) : null}
        {saved ? <p className="success-box">{t('reminderRecipients.savedNotice')}</p> : null}
      </form>
    </section>
  );
}

import type {
  CommunicationChannel,
  CommunicationPreference,
  SupportedLocale,
} from '@caredesk/application';
import {
  MEDICATION_DAYS,
  MEDICATION_TIMES,
  canReceiveReminders,
  reminderContactFor,
  type MvpMedication,
  type MvpMedicationDay,
  type MvpMedicationTime,
  type MvpReminderChannel,
  type MvpReminderRecipient,
} from '../storage/mvp-storage.js';

/**
 * Which medication reminders are due right now, and to whom.
 *
 * Everything here is pure: no network, no storage, no `Date.now()`, no
 * randomness. The caller passes the instant and the set of reminder keys it has
 * already sent, and gets back a decision it can act on and log. That matters
 * because the failure modes of a reminder system are invisible by nature - a
 * message that was never sent looks exactly like a quiet evening - so the
 * decision has to be reproducible from its inputs when a family asks why they
 * were not told.
 *
 * The plan reports what it did NOT do as loudly as what it did. A recipient who
 * is dropped for a missing consent, and a dose suppressed by quiet hours, are
 * both returned as explicit entries rather than absences.
 */

/** All times in this module are the household's wall clock, not UTC. */
export const REMINDER_TIME_ZONE = 'Asia/Jerusalem';

/**
 * The concrete local time each named slot fires at.
 *
 * The storage model deliberately keeps slots as names ("evening") because
 * households speak that way, so the mapping to a clock time has to live
 * somewhere. It lives here, as data, so it can be retuned after the pilot
 * without touching any of the logic or the tests that pin the logic down.
 *
 * `night` is 20:00 rather than a genuinely late hour on purpose: the default
 * quiet window opens at 21:00, and a night-dose reminder that quiet hours
 * swallow every single day is worse than one that arrives a little early.
 */
export const MEDICATION_SLOT_TIMES: Readonly<Record<MvpMedicationTime, string>> = {
  morning: '08:00',
  noon: '13:00',
  evening: '18:00',
  night: '20:00',
};

/**
 * How long after its slot time a dose is still worth reminding about.
 *
 * A scheduler does not tick at the exact second, and a reminder for the 08:00
 * dose is still useful at 08:40. It is not useful at noon, by which point it
 * competes with the next dose and teaches people to ignore the channel.
 */
export const SLOT_GRACE_MINUTES = 60;

/**
 * The fields below are not this module's invention. They are the columns of
 * `notification_intent` (migration 0025) and the fields of the application-layer
 * `NotificationIntent`. This module produces a draft of that row - it does not
 * define a second message format alongside the one the product already has.
 *
 * `event_type` names what happened in the product; `template_key` +
 * `template_version` select the wording the send layer renders in the
 * recipient's locale. Neither is rendered text, so no Hebrew string literal has
 * to live in source (Constitution 8), and a wording change is a version bump
 * rather than a code change here.
 */
export const REMINDER_EVENT_TYPE = 'medication.dose_due';
export const REMINDER_TEMPLATE_KEY = 'medication.dose_due';
export const REMINDER_TEMPLATE_VERSION = 1;

/**
 * In-app destination the message links to; the details live behind the login.
 * `notification_intent.authenticated_path` is constrained to `like '/%'`.
 */
export const REMINDER_APP_PATH = '/medications';

/**
 * The locale used when the recipient has no recorded preference.
 *
 * `communication_preference.preferred_locale` is per participant server-side.
 * The workspace recipient model has no locale field at all, so every reminder
 * currently renders in Hebrew unless the caller says otherwise. That is stated
 * here rather than hidden, because a daughter who reads English gets a Hebrew
 * message and nobody finds out.
 */
export const REMINDER_DEFAULT_LOCALE: SupportedLocale = 'he';

/**
 * Compile-time proof that the workspace channel union and the pipeline channel
 * union stay identical. If either side gains a channel the other lacks, this
 * stops the build instead of silently producing an intent the orchestrator has
 * no provider for.
 */
type ChannelUnionsAligned = MvpReminderChannel extends CommunicationChannel
  ? CommunicationChannel extends MvpReminderChannel
    ? true
    : never
  : never;
export const REMINDER_CHANNELS_MATCH_PIPELINE: ChannelUnionsAligned = true;

/** Why a recipient on the list will not be contacted. Mirrors `canReceiveReminders`. */
export type RecipientSkipReason = 'paused' | 'no-consent' | 'no-contact';

/** Why a dose that exists in the list did not turn into a message. */
export type MedicationSkipReason =
  | 'as-needed'
  | 'not-daily'
  | 'not-today'
  | 'already-sent'
  | 'quiet-hours'
  | 'no-eligible-recipients';

/** A recipient this send would actually go to, resolved to one address. */
export interface ReminderTarget {
  recipientId: string;
  name: string;
  channel: MvpReminderChannel;
  /** Phone or email, whichever the recipient's channel delivers to. */
  contact: string;
}

export interface SkippedRecipient {
  recipientId: string;
  name: string;
  reason: RecipientSkipReason;
}

export interface SkippedMedication {
  medicationId: string;
  /** Absent when the whole medication was skipped rather than one slot. */
  slot?: MvpMedicationTime;
  reason: MedicationSkipReason;
}

/**
 * The only values the rendered message may interpolate.
 *
 * Note what is absent: no medication name, no dosage, no notes. A family phone
 * in Israel is a shared object - it sits on the kitchen table, the screen
 * lights up in front of guests, a grandchild picks it up. Naming the drug on a
 * lock screen discloses the diagnosis of a third party to whoever is in the
 * room. The message says a dose is due and links into the app, where the reader
 * is authenticated. This type is the enforcement point: a template can only
 * interpolate what this object carries.
 */
export interface ReminderTemplateVariables {
  slot: MvpMedicationTime;
  /** The slot's local clock time, for a message like "the 08:00 dose". */
  slotTime: string;
  /** Local (Asia/Jerusalem) calendar day, yyyy-mm-dd. */
  localDate: string;
}

/**
 * One `notification_intent` row waiting for the fields only the server owns.
 *
 * Absent on purpose: `id` and `tenant_id` (assigned inside the tenant
 * transaction) and `status` (the pipeline's, not the planner's). Everything
 * else is filled in here so the server side is an insert plus a call to
 * `NotificationOrchestrator.deliver`, with no reshaping in between.
 */
export interface ReminderIntentDraft {
  /** `notification_intent.recipient_type`. Reminder recipients are family. */
  recipientType: 'family_member';
  /**
   * `notification_intent.recipient_id`.
   *
   * Today this is a workspace-local recipient id, which is not the uuid the
   * column expects. It is named `recipientRef` rather than `recipientId` so the
   * mismatch is visible at the call site: whatever persists these intents must
   * resolve this reference to a server-side recipient before inserting. See
   * `docs/governance/REMINDERS-INTEGRATION.md`.
   */
  recipientRef: string;
  /** Local display only - who the household sees on the plan. Never sent. */
  recipientName: string;
  eventType: typeof REMINDER_EVENT_TYPE;
  templateKey: typeof REMINDER_TEMPLATE_KEY;
  templateVersion: number;
  locale: SupportedLocale;
  authenticatedPath: string;
  /**
   * `notification_intent.idempotency_key`, unique per tenant. One dose produces
   * one intent per recipient, so the recipient is part of the key: without it
   * the second recipient's insert would collide with the first one's and one
   * person would silently never be told.
   */
  idempotencyKey: string;
  templateVariables: ReminderTemplateVariables;
  /** Passed straight to `NotificationOrchestrator.deliver`. */
  destinationByChannel: Partial<Record<CommunicationChannel, string>>;
  /**
   * The recipient's workspace consent and channel expressed in the pipeline's
   * own preference shape, so `eligibleChannels` gates the send rather than a
   * second, parallel consent rule.
   */
  preference: CommunicationPreference;
}

export interface DueReminder {
  /**
   * The dose-level key. The caller persists it after a successful send and
   * passes it back on the next tick; this module never remembers anything.
   * Per-recipient idempotency lives on each intent's `idempotencyKey`.
   */
  key: string;
  medicationId: string;
  slot: MvpMedicationTime;
  /** Local (Asia/Jerusalem) calendar day, yyyy-mm-dd. */
  localDate: string;
  /** Who would be told, resolved to one address each. */
  targets: ReminderTarget[];
  /** One draft intent per target, in the same order. */
  intents: ReminderIntentDraft[];
}

export interface ReminderPlan {
  due: DueReminder[];
  skippedRecipients: SkippedRecipient[];
  skippedMedications: SkippedMedication[];
  /** Local wall clock the plan was computed against, for the audit trail. */
  localDate: string;
  localTime: string;
  /** True when the instant fell inside the household's quiet window. */
  quietHours: boolean;
}

export interface ReminderPlanInput {
  medications: readonly MvpMedication[];
  recipients: readonly MvpReminderRecipient[];
  /** The instant to decide about; supplied by the caller, never read from the clock here. */
  now: Date;
  /** `quietHoursStart` / `quietHoursEnd` from MvpProfile, as "HH:MM". */
  quietHoursStart: string;
  quietHoursEnd: string;
  /** Keys already sent, from the caller's own store. */
  alreadySent?: Iterable<string>;
  /**
   * Locale for every intent this tick. A single value because the workspace
   * recipient model records no per-recipient locale; once recipients live in
   * `communication_preference` this is read per recipient instead.
   */
  locale?: SupportedLocale;
}

/** The household's wall clock at a given instant, in Asia/Jerusalem. */
export interface WallClock {
  /** yyyy-mm-dd */
  date: string;
  /** HH:MM */
  time: string;
  /** Minutes since local midnight, for comparisons. */
  minutes: number;
}

const wallClockParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: REMINDER_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Converts an instant to Jerusalem wall-clock fields.
 *
 * Doses are taken on a wall clock, so the whole module reasons in local time.
 * Israel changes offset twice a year, and doing this arithmetic by adding a
 * fixed +02:00 would move every reminder by an hour for half the year - which
 * is exactly the kind of bug nobody reports, they just stop trusting the app.
 * Intl carries the tz database, so it stays correct when the rules change.
 */
export function jerusalemWallClock(instant: Date): WallClock {
  const parts = wallClockParts.formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  // Some ICU versions render local midnight as hour "24" under hour12:false.
  const rawHour = value('hour');
  const hour = rawHour === '24' ? '00' : rawHour;
  const minute = value('minute');
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${hour}:${minute}`,
    minutes: Number(hour) * 60 + Number(minute),
  };
}

const weekdayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: REMINDER_TIME_ZONE,
  weekday: 'long',
});

/** English weekday name to the stored day token. Keyed by what Intl emits. */
const WEEKDAY_BY_NAME: Readonly<Record<string, MvpMedicationDay>> = Object.fromEntries(
  MEDICATION_DAYS.map((day) => [day, day]),
);

/**
 * The Jerusalem calendar day of the week at an instant.
 *
 * Deliberately not a field on `WallClock`: the wall clock is compared for
 * equality all over the tests, and a day name is a different question from
 * "what time is it". It is also computed from the tz database rather than from
 * `getDay()`, because `getDay()` answers for the machine's zone - a server in
 * UTC would call Friday 23:30 in Tel Aviv a Friday, which it is not.
 *
 * Returns null if the formatter ever emits something unrecognised, so the
 * caller decides what to do rather than this function inventing a day.
 */
export function jerusalemWeekday(instant: Date): MvpMedicationDay | null {
  return WEEKDAY_BY_NAME[weekdayFormat.format(instant).toLowerCase()] ?? null;
}

/** "HH:MM" to minutes since midnight; null when the value is not a usable time. */
export function minutesFromTime(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match?.[1] || !match[2]) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Whether a local time falls inside the quiet window.
 *
 * The window is half-open: it includes its start and excludes its end, so the
 * default 21:00-08:00 leaves the 08:00 morning dose sendable rather than
 * suppressing the first reminder of every day by one minute of overlap.
 *
 * A window whose start equals its end is treated as "no quiet hours" rather
 * than "quiet all day". Silence for 24 hours is never what someone meant to
 * configure, and the consequence of getting it wrong is a permanently mute
 * reminder system.
 */
export function isWithinQuietHours(minutes: number, start: string, end: string): boolean {
  const from = minutesFromTime(start);
  const to = minutesFromTime(end);
  // Unparseable configuration fails open: an unreadable setting should not
  // silently cancel medication reminders.
  if (from === null || to === null || from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/**
 * The idempotency key for one dose. Deterministic by construction - same
 * medication, same slot, same local day, same string - so two schedulers
 * racing on the same tick converge on one send instead of two.
 */
export function reminderKeyFor(
  medicationId: string,
  slot: MvpMedicationTime,
  localDate: string,
): string {
  return `medication:${medicationId}:${slot}:${localDate}`;
}

/**
 * The per-recipient idempotency key for one dose.
 *
 * `notification_intent.idempotency_key` is unique per tenant, and a dose fans
 * out to several people, so the dose key alone would let the first recipient's
 * row swallow everyone else's under `on conflict do nothing`.
 */
export function reminderIntentKeyFor(doseKey: string, recipientId: string): string {
  return `${doseKey}:${recipientId}`;
}

/**
 * The recipient's workspace consent, expressed in the pipeline's preference
 * shape.
 *
 * The two models say the same thing differently. The workspace records one
 * consent moment per person plus the one channel they chose; the pipeline
 * records a per-channel enable flag plus a per-channel consent state. The
 * translation is deliberately narrow: only the chosen channel is enabled, and
 * only the chosen channel is granted. Enabling the others "because they
 * consented" would send over a channel the person never agreed to, and for the
 * daughter abroad on a data-only eSIM it would pick SMS and reach nobody.
 *
 * `canReceiveReminders` has already been applied before this is called, so an
 * unconsented recipient never reaches here; the granted state is a
 * restatement of a gate that has passed, not a second opinion.
 */
export function reminderPreferenceFor(
  recipient: MvpReminderRecipient,
  locale: SupportedLocale,
): CommunicationPreference {
  const channel: CommunicationChannel = recipient.channel;
  return {
    emailEnabled: channel === 'email',
    whatsappEnabled: channel === 'whatsapp',
    smsEnabled: channel === 'sms',
    preferredChannel: channel,
    preferredLocale: locale,
    whatsappConsent: channel === 'whatsapp' ? 'granted' : 'unknown',
    smsConsent: channel === 'sms' ? 'granted' : 'unknown',
  };
}

/** The single destination the recipient's chosen channel delivers to. */
export function reminderDestinationsFor(
  recipient: MvpReminderRecipient,
): Partial<Record<CommunicationChannel, string>> {
  return { [recipient.channel]: reminderContactFor(recipient) };
}

/** True when `now` is inside the slot's send window on the local clock. */
export function isSlotDue(slot: MvpMedicationTime, nowMinutes: number): boolean {
  const slotMinutes = minutesFromTime(MEDICATION_SLOT_TIMES[slot]);
  if (slotMinutes === null) return false;
  return nowMinutes >= slotMinutes && nowMinutes < slotMinutes + SLOT_GRACE_MINUTES;
}

/**
 * Why this person is not being contacted, in the same order the UI states it.
 * Returns null when they can be contacted.
 */
export function recipientSkipReason(recipient: MvpReminderRecipient): RecipientSkipReason | null {
  if (canReceiveReminders(recipient)) return null;
  if (!recipient.active) return 'paused';
  if (recipient.consentAt.trim() === '') return 'no-consent';
  return 'no-contact';
}

/**
 * The slots a medication is eligible for on a given day.
 *
 * Two rules, both deliberately conservative:
 *
 * An empty `timesOfDay` means "as needed" in the storage model, not "unknown".
 * A dose that is taken when a symptom appears has no schedule to remind about,
 * so it never generates a message.
 *
 * `daily: false` means the family said this is taken on specific days. Which
 * days is now recorded, so the rule splits three ways:
 *
 * - days chosen, today is one of them: it fires like any daily medication.
 * - days chosen, today is not one: skipped as `not-today`. Reported rather than
 *   dropped, because "why did nothing arrive on Tuesday" has to be answerable.
 * - no days chosen, or the field absent because the record predates it: nothing
 *   is sent and the skip is reported as `not-daily`, exactly as before. Guessing
 *   (every other day? weekdays? the day it was entered?) is the worse failure:
 *   a reminder for a dose that is not due teaches a household to swipe
 *   reminders away, which then costs them a real one. The screen that owns the
 *   day picker says out loud that no reminder will be sent until days are set,
 *   so this silence is stated to the user rather than only logged here.
 *
 * A medication marked `daily` fires every day whatever the day list says; the
 * list only describes the non-daily case.
 */
function medicationSkipReason(
  medication: MvpMedication,
  today: MvpMedicationDay | null,
): MedicationSkipReason | null {
  if (medication.timesOfDay.length === 0) return 'as-needed';
  if (medication.daily) return null;
  const days = medication.daysOfWeek ?? [];
  if (days.length === 0) return 'not-daily';
  // A day we cannot name is a day we cannot match: fail closed rather than fire
  // a non-daily reminder on a day nobody asked for.
  if (today === null || !days.includes(today)) return 'not-today';
  return null;
}

export function planMedicationReminders(input: ReminderPlanInput): ReminderPlan {
  const { medications, recipients, now, quietHoursStart, quietHoursEnd } = input;
  const clock = jerusalemWallClock(now);
  const today = jerusalemWeekday(now);
  const quiet = isWithinQuietHours(clock.minutes, quietHoursStart, quietHoursEnd);
  const alreadySent = new Set(input.alreadySent ?? []);

  const locale = input.locale ?? REMINDER_DEFAULT_LOCALE;

  const targets: ReminderTarget[] = [];
  const eligible: MvpReminderRecipient[] = [];
  const skippedRecipients: SkippedRecipient[] = [];
  for (const recipient of recipients) {
    const reason = recipientSkipReason(recipient);
    if (reason) {
      skippedRecipients.push({ recipientId: recipient.id, name: recipient.name, reason });
      continue;
    }
    eligible.push(recipient);
    targets.push({
      recipientId: recipient.id,
      name: recipient.name,
      channel: recipient.channel,
      contact: reminderContactFor(recipient),
    });
  }

  const due: DueReminder[] = [];
  const skippedMedications: SkippedMedication[] = [];
  // Guards against a medication that lists the same slot twice, and against two
  // rows for the same medication id, without relying on the caller's store.
  const plannedKeys = new Set<string>();

  for (const medication of medications) {
    const skip = medicationSkipReason(medication, today);
    if (skip) {
      skippedMedications.push({ medicationId: medication.id, reason: skip });
      continue;
    }

    // Iterate the canonical slot order so the plan is stable regardless of the
    // order the family happened to tick the boxes in.
    for (const slot of MEDICATION_TIMES) {
      if (!medication.timesOfDay.includes(slot)) continue;
      // Outside its window a slot is simply not this tick's business; reporting
      // it would bury the skips that a human actually needs to see.
      if (!isSlotDue(slot, clock.minutes)) continue;

      const key = reminderKeyFor(medication.id, slot, clock.date);
      if (alreadySent.has(key) || plannedKeys.has(key)) {
        skippedMedications.push({ medicationId: medication.id, slot, reason: 'already-sent' });
        continue;
      }
      if (quiet) {
        // Suppressed, not deferred. Nothing re-queues this dose when the quiet
        // window ends, because a message at 08:00 about a dose that was due at
        // 22:00 reads as "take it now" and is worse than saying nothing.
        skippedMedications.push({ medicationId: medication.id, slot, reason: 'quiet-hours' });
        continue;
      }
      if (targets.length === 0) {
        skippedMedications.push({
          medicationId: medication.id,
          slot,
          reason: 'no-eligible-recipients',
        });
        continue;
      }

      plannedKeys.add(key);
      const templateVariables: ReminderTemplateVariables = {
        slot,
        slotTime: MEDICATION_SLOT_TIMES[slot],
        localDate: clock.date,
      };
      due.push({
        key,
        medicationId: medication.id,
        slot,
        localDate: clock.date,
        targets,
        intents: eligible.map((recipient) => ({
          recipientType: 'family_member',
          recipientRef: recipient.id,
          recipientName: recipient.name,
          eventType: REMINDER_EVENT_TYPE,
          templateKey: REMINDER_TEMPLATE_KEY,
          templateVersion: REMINDER_TEMPLATE_VERSION,
          locale,
          authenticatedPath: REMINDER_APP_PATH,
          idempotencyKey: reminderIntentKeyFor(key, recipient.id),
          templateVariables,
          destinationByChannel: reminderDestinationsFor(recipient),
          preference: reminderPreferenceFor(recipient, locale),
        })),
      });
    }
  }

  return {
    due,
    skippedRecipients,
    skippedMedications,
    localDate: clock.date,
    localTime: clock.time,
    quietHours: quiet,
  };
}

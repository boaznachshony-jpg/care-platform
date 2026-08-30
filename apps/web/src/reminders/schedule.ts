import {
  MEDICATION_TIMES,
  canReceiveReminders,
  reminderContactFor,
  type MvpMedication,
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
 * i18n key for the message body. The payload carries a key, never rendered
 * text, so the send layer resolves it in the recipient's language - and so no
 * Hebrew string literal has to live in source (Constitution 8).
 */
export const REMINDER_MESSAGE_KEY = 'medicationReminder.body';

/** In-app destination the message links to; the details live behind the login. */
export const REMINDER_APP_PATH = '/medications';

/** Why a recipient on the list will not be contacted. Mirrors `canReceiveReminders`. */
export type RecipientSkipReason = 'paused' | 'no-consent' | 'no-contact';

/** Why a dose that exists in the list did not turn into a message. */
export type MedicationSkipReason =
  'as-needed' | 'not-daily' | 'already-sent' | 'quiet-hours' | 'no-eligible-recipients';

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
 * What is sent. Note what is absent: no medication name, no dosage, no notes.
 *
 * A family phone in Israel is a shared object - it sits on the kitchen table,
 * the screen lights up in front of guests, a grandchild picks it up. Naming the
 * drug on a lock screen discloses the diagnosis of a third party to whoever is
 * in the room. The message says a dose is due and links into the app, where the
 * reader is authenticated.
 */
export interface ReminderPayload {
  messageKey: string;
  slot: MvpMedicationTime;
  /** The slot's local clock time, for a message like "the 08:00 dose". */
  slotTime: string;
  appPath: string;
}

export interface DueReminder {
  /**
   * The idempotency key. The caller persists it after a successful send and
   * passes it back on the next tick; this module never remembers anything.
   */
  key: string;
  medicationId: string;
  slot: MvpMedicationTime;
  /** Local (Asia/Jerusalem) calendar day, yyyy-mm-dd. */
  localDate: string;
  payload: ReminderPayload;
  targets: ReminderTarget[];
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
 * `daily: false` means the family said this is taken on specific days - and the
 * model records no day list, because the form never asked for one. Rather than
 * guess (every other day? weekdays? the day it was entered?), nothing is sent
 * and the medication is reported as skipped. A reminder for a dose that is not
 * due today is not a harmless extra: it is the message that teaches a household
 * to swipe reminders away, which then costs them a real one. When per-day
 * scheduling is added to the model this rule is the single place to change.
 */
function medicationSkipReason(medication: MvpMedication): MedicationSkipReason | null {
  if (medication.timesOfDay.length === 0) return 'as-needed';
  if (!medication.daily) return 'not-daily';
  return null;
}

export function planMedicationReminders(input: ReminderPlanInput): ReminderPlan {
  const { medications, recipients, now, quietHoursStart, quietHoursEnd } = input;
  const clock = jerusalemWallClock(now);
  const quiet = isWithinQuietHours(clock.minutes, quietHoursStart, quietHoursEnd);
  const alreadySent = new Set(input.alreadySent ?? []);

  const targets: ReminderTarget[] = [];
  const skippedRecipients: SkippedRecipient[] = [];
  for (const recipient of recipients) {
    const reason = recipientSkipReason(recipient);
    if (reason) {
      skippedRecipients.push({ recipientId: recipient.id, name: recipient.name, reason });
      continue;
    }
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
    const skip = medicationSkipReason(medication);
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
      due.push({
        key,
        medicationId: medication.id,
        slot,
        localDate: clock.date,
        payload: {
          messageKey: REMINDER_MESSAGE_KEY,
          slot,
          slotTime: MEDICATION_SLOT_TIMES[slot],
          appPath: REMINDER_APP_PATH,
        },
        targets,
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

import { describe, expect, it } from 'vitest';
import { MEDICATION_DAYS } from '../storage/mvp-storage.js';
import type { MvpMedication, MvpReminderRecipient } from '../storage/mvp-storage.js';
import {
  MEDICATION_SLOT_TIMES,
  REMINDER_APP_PATH,
  REMINDER_EVENT_TYPE,
  REMINDER_TEMPLATE_KEY,
  REMINDER_TEMPLATE_VERSION,
  isSlotDue,
  isWithinQuietHours,
  jerusalemWallClock,
  jerusalemWeekday,
  minutesFromTime,
  planMedicationReminders,
  recipientSkipReason,
  reminderKeyFor,
} from './schedule.js';

const DEFAULT_QUIET = { quietHoursStart: '21:00', quietHoursEnd: '08:00' };

function medication(overrides: Partial<MvpMedication> = {}): MvpMedication {
  return {
    id: 'med-1',
    name: 'Eliquis',
    dosage: '1 tablet',
    timesOfDay: ['morning'],
    daily: true,
    prescribingDoctor: 'Dr Levi',
    notes: '',
    updatedAt: '2026-08-01T09:00:00.000Z',
    ...overrides,
  };
}

function recipient(overrides: Partial<MvpReminderRecipient> = {}): MvpReminderRecipient {
  return {
    id: 'rec-1',
    name: 'Dana',
    relationship: 'daughter',
    phone: '+972501234567',
    email: '',
    channel: 'sms',
    consentAt: '2026-07-01T08:00:00.000Z',
    consentBy: 'Boaz',
    active: true,
    updatedAt: '2026-07-01T08:00:00.000Z',
    ...overrides,
  };
}

/** 08:05 Jerusalem on a summer day (UTC+3), inside the morning window. */
const MORNING_INSTANT = new Date('2026-08-20T05:05:00Z');

function plan(overrides: Partial<Parameters<typeof planMedicationReminders>[0]> = {}) {
  return planMedicationReminders({
    medications: [medication()],
    recipients: [recipient()],
    now: MORNING_INSTANT,
    ...DEFAULT_QUIET,
    ...overrides,
  });
}

describe('jerusalemWallClock', () => {
  it('reads an instant on the household wall clock, not UTC', () => {
    const clock = jerusalemWallClock(new Date('2026-08-20T05:05:00Z'));
    expect(clock).toEqual({ date: '2026-08-20', time: '08:05', minutes: 485 });
  });

  it('applies the winter offset (UTC+2)', () => {
    expect(jerusalemWallClock(new Date('2026-01-15T06:00:00Z')).time).toBe('08:00');
  });

  it('reports local midnight as 00:00 on the next local day', () => {
    const clock = jerusalemWallClock(new Date('2026-03-27T21:30:00Z'));
    expect(clock.date).toBe('2026-03-28');
    expect(clock.time).toBe('00:30');
    expect(clock.minutes).toBe(30);
  });
});

describe('DST transition (Israel moves to summer time on 27 March 2026)', () => {
  it('treats the same UTC hour as different local times either side of the change', () => {
    // 06:00Z is 08:00 local while the country is on UTC+2 ...
    expect(jerusalemWallClock(new Date('2026-03-26T06:00:00Z')).time).toBe('08:00');
    // ... and 09:00 local the morning after the clocks go forward.
    expect(jerusalemWallClock(new Date('2026-03-27T06:00:00Z')).time).toBe('09:00');
  });

  it('fires the morning dose on the wall clock across the change, not on a fixed offset', () => {
    expect(plan({ now: new Date('2026-03-26T06:00:00Z') }).due).toHaveLength(1);
    // Same UTC hour, day after the change: the morning window has passed.
    expect(plan({ now: new Date('2026-03-27T06:00:00Z') }).due).toHaveLength(0);
    // 05:00Z is 08:00 local once summer time is in force.
    expect(plan({ now: new Date('2026-03-27T05:00:00Z') }).due).toHaveLength(1);
  });
});

describe('minutesFromTime', () => {
  it('parses a wall-clock time', () => {
    expect(minutesFromTime('21:00')).toBe(1260);
    expect(minutesFromTime('00:00')).toBe(0);
    expect(minutesFromTime(' 8:05 ')).toBe(485);
  });

  it('rejects values that are not usable times', () => {
    expect(minutesFromTime('')).toBeNull();
    expect(minutesFromTime('24:00')).toBeNull();
    expect(minutesFromTime('08:60')).toBeNull();
    expect(minutesFromTime('morning')).toBeNull();
  });
});

describe('slot mapping', () => {
  it('maps every named slot to a concrete local time', () => {
    expect(MEDICATION_SLOT_TIMES).toEqual({
      morning: '08:00',
      noon: '13:00',
      evening: '18:00',
      night: '20:00',
    });
  });

  it('keeps the night slot outside the default quiet window so it can ever be sent', () => {
    const nightMinutes = minutesFromTime(MEDICATION_SLOT_TIMES.night) ?? -1;
    expect(nightMinutes).toBeGreaterThan(0);
    const { quietHoursStart, quietHoursEnd } = DEFAULT_QUIET;
    expect(isWithinQuietHours(nightMinutes, quietHoursStart, quietHoursEnd)).toBe(false);
  });

  it('is due from the slot time until the grace window closes', () => {
    expect(isSlotDue('morning', 8 * 60 - 1)).toBe(false);
    expect(isSlotDue('morning', 8 * 60)).toBe(true);
    expect(isSlotDue('morning', 8 * 60 + 59)).toBe(true);
    expect(isSlotDue('morning', 9 * 60)).toBe(false);
  });
});

describe('quiet hours', () => {
  it('handles a window that crosses midnight', () => {
    expect(isWithinQuietHours(22 * 60, '21:00', '08:00')).toBe(true);
    expect(isWithinQuietHours(2 * 60, '21:00', '08:00')).toBe(true);
    expect(isWithinQuietHours(12 * 60, '21:00', '08:00')).toBe(false);
  });

  it('includes the start and excludes the end, so the 08:00 dose still goes out', () => {
    expect(isWithinQuietHours(21 * 60, '21:00', '08:00')).toBe(true);
    expect(isWithinQuietHours(8 * 60, '21:00', '08:00')).toBe(false);
  });

  it('handles a same-day window', () => {
    expect(isWithinQuietHours(14 * 60, '13:00', '16:00')).toBe(true);
    expect(isWithinQuietHours(17 * 60, '13:00', '16:00')).toBe(false);
  });

  it('fails open on an unusable or empty configuration', () => {
    expect(isWithinQuietHours(3 * 60, '', '')).toBe(false);
    expect(isWithinQuietHours(3 * 60, 'nine', '08:00')).toBe(false);
    expect(isWithinQuietHours(3 * 60, '21:00', '21:00')).toBe(false);
  });

  it('suppresses a due dose and says so, instead of dropping it silently', () => {
    // 22:05 local: the night dose is inside its grace window only if quiet
    // hours start later, so widen the medication to the night slot and move
    // the quiet window to prove suppression rather than a missed window.
    const result = plan({
      medications: [medication({ timesOfDay: ['morning'] })],
      quietHoursStart: '07:00',
      quietHoursEnd: '09:00',
    });
    expect(result.quietHours).toBe(true);
    expect(result.due).toHaveLength(0);
    expect(result.skippedMedications).toEqual([
      { medicationId: 'med-1', slot: 'morning', reason: 'quiet-hours' },
    ]);
  });

  it('does not re-queue a suppressed dose once quiet hours end', () => {
    // Same day, 10:00 local, quiet hours over - the morning window has passed
    // and nothing resurrects it.
    const result = plan({
      now: new Date('2026-08-20T07:00:00Z'),
      quietHoursStart: '07:00',
      quietHoursEnd: '09:00',
    });
    expect(result.quietHours).toBe(false);
    expect(result.due).toHaveLength(0);
    expect(result.skippedMedications).toHaveLength(0);
  });
});

describe('medication rules', () => {
  it('never reminds about an as-needed medication (empty timesOfDay)', () => {
    const result = plan({ medications: [medication({ timesOfDay: [] })] });
    expect(result.due).toHaveLength(0);
    expect(result.skippedMedications).toEqual([{ medicationId: 'med-1', reason: 'as-needed' }]);
  });

  it('never fires a medication that is not taken daily and names no days', () => {
    const result = plan({ medications: [medication({ daily: false, daysOfWeek: [] })] });
    expect(result.due).toHaveLength(0);
    expect(result.skippedMedications).toEqual([{ medicationId: 'med-1', reason: 'not-daily' }]);
  });

  it('leaves a record saved before the day field existed exactly as it was', () => {
    // A legacy row has no `daysOfWeek` at all. Adding the field must not make
    // it start firing on a guess, and must not change what it already did.
    const legacyDaily = medication();
    const legacyNonDaily = medication({ id: 'med-legacy', daily: false });
    expect('daysOfWeek' in legacyDaily).toBe(false);
    expect('daysOfWeek' in legacyNonDaily).toBe(false);

    const stillFires = plan({ medications: [legacyDaily] });
    expect(stillFires.due.map((item) => item.medicationId)).toEqual(['med-1']);
    expect(stillFires.skippedMedications).toHaveLength(0);

    const stillSilent = plan({ medications: [legacyNonDaily] });
    expect(stillSilent.due).toHaveLength(0);
    expect(stillSilent.skippedMedications).toEqual([
      { medicationId: 'med-legacy', reason: 'not-daily' },
    ]);
  });

  it('survives a round trip through the workspace JSON blob', () => {
    // The store keeps medications as a JSON blob, so the representation has to
    // mean the same thing after JSON.parse(JSON.stringify(x)) - which is why
    // the days are names rather than a Set, a bitmask or Date objects.
    const saved = medication({ daily: false, daysOfWeek: ['sunday', 'thursday'] });
    const reloaded = JSON.parse(JSON.stringify([saved])) as MvpMedication[];
    expect(reloaded[0]).toEqual(saved);
    expect(plan({ medications: reloaded }).due).toHaveLength(1);
  });

  it('fires a non-daily medication on a day it was marked for', () => {
    // 2026-08-20 is a Thursday in Jerusalem.
    const result = plan({
      medications: [medication({ daily: false, daysOfWeek: ['sunday', 'thursday'] })],
    });
    expect(result.due.map((item) => item.slot)).toEqual(['morning']);
    expect(result.skippedMedications).toHaveLength(0);
  });

  it('says why nothing was sent on a day the medication is not taken', () => {
    const result = plan({
      medications: [medication({ daily: false, daysOfWeek: ['sunday', 'friday'] })],
    });
    expect(result.due).toHaveLength(0);
    expect(result.skippedMedications).toEqual([{ medicationId: 'med-1', reason: 'not-today' }]);
  });

  it('reads the day of the week on the Jerusalem clock, not the machine zone', () => {
    // 21:30Z on a Thursday in summer is already Friday 00:30 in Tel Aviv.
    expect(jerusalemWeekday(new Date('2026-08-20T05:05:00Z'))).toBe('thursday');
    expect(jerusalemWeekday(new Date('2026-08-20T21:30:00Z'))).toBe('friday');
    expect(jerusalemWeekday(new Date('2026-08-22T09:00:00Z'))).toBe('saturday');
    expect(jerusalemWeekday(new Date('2026-08-23T09:00:00Z'))).toBe('sunday');
  });

  it('keeps the Israeli week order, Sunday first', () => {
    expect(MEDICATION_DAYS).toEqual([
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ]);
  });

  it('ignores the day list when the medication is taken every day', () => {
    const result = plan({ medications: [medication({ daily: true, daysOfWeek: ['sunday'] })] });
    expect(result.due).toHaveLength(1);
  });

  it('still refuses an as-needed medication even when days are chosen', () => {
    const result = plan({
      medications: [medication({ timesOfDay: [], daily: false, daysOfWeek: ['thursday'] })],
    });
    expect(result.skippedMedications).toEqual([{ medicationId: 'med-1', reason: 'as-needed' }]);
  });

  it('only fires the slot whose window is open', () => {
    const result = plan({
      medications: [medication({ timesOfDay: ['morning', 'noon', 'evening', 'night'] })],
    });
    expect(result.due.map((item) => item.slot)).toEqual(['morning']);
  });

  it('emits slots in the canonical order regardless of how they were entered', () => {
    // 13:30 local, with both the noon slot open and an evening slot listed first.
    const result = plan({
      now: new Date('2026-08-20T10:30:00Z'),
      medications: [
        medication({ id: 'med-evening', timesOfDay: ['evening'] }),
        medication({ id: 'med-noon', timesOfDay: ['noon'] }),
      ],
    });
    expect(result.due.map((item) => item.medicationId)).toEqual(['med-noon']);
  });
});

describe('idempotency', () => {
  it('builds a deterministic key from medication, slot and local day', () => {
    expect(reminderKeyFor('med-1', 'morning', '2026-08-20')).toBe(
      'medication:med-1:morning:2026-08-20',
    );
    expect(plan().due[0]?.key).toBe('medication:med-1:morning:2026-08-20');
  });

  it('does not resend a dose whose key the caller has already stored', () => {
    const first = plan();
    const second = plan({ alreadySent: first.due.map((item) => item.key) });
    expect(second.due).toHaveLength(0);
    expect(second.skippedMedications).toEqual([
      { medicationId: 'med-1', slot: 'morning', reason: 'already-sent' },
    ]);
  });

  it('produces one reminder even if a slot is listed twice', () => {
    const result = plan({
      medications: [medication({ timesOfDay: ['morning', 'morning'] })],
    });
    expect(result.due).toHaveLength(1);
  });

  it('starts a fresh key on the next local day', () => {
    const today = plan();
    const tomorrow = plan({
      now: new Date('2026-08-21T05:05:00Z'),
      alreadySent: today.due.map((item) => item.key),
    });
    expect(tomorrow.due).toHaveLength(1);
    expect(tomorrow.due[0]?.key).toBe('medication:med-1:morning:2026-08-21');
  });

  it('is a pure function of its inputs - same input, same plan', () => {
    expect(plan()).toEqual(plan());
  });
});

describe('recipients', () => {
  it('targets only recipients who pass canReceiveReminders', () => {
    const result = plan({
      recipients: [
        recipient({ id: 'ready' }),
        recipient({ id: 'paused', active: false }),
        recipient({ id: 'no-consent', consentAt: '' }),
        recipient({ id: 'no-contact', phone: '  ' }),
      ],
    });
    expect(result.due[0]?.targets.map((target) => target.recipientId)).toEqual(['ready']);
  });

  it('reports every skipped recipient with a reason rather than dropping them', () => {
    const result = plan({
      recipients: [
        recipient({ id: 'paused', active: false }),
        recipient({ id: 'no-consent', consentAt: '' }),
        recipient({ id: 'no-contact', channel: 'email', email: '' }),
        recipient({ id: 'ready' }),
      ],
    });
    expect(result.skippedRecipients).toEqual([
      { recipientId: 'paused', name: 'Dana', reason: 'paused' },
      { recipientId: 'no-consent', name: 'Dana', reason: 'no-consent' },
      { recipientId: 'no-contact', name: 'Dana', reason: 'no-contact' },
    ]);
  });

  it('classifies a skip the same way the recipients screen does', () => {
    expect(recipientSkipReason(recipient())).toBeNull();
    expect(recipientSkipReason(recipient({ active: false }))).toBe('paused');
    expect(recipientSkipReason(recipient({ consentAt: '' }))).toBe('no-consent');
    expect(recipientSkipReason(recipient({ channel: 'email', email: '' }))).toBe('no-contact');
  });

  it('resolves each target to the address its own channel delivers to', () => {
    const result = plan({
      recipients: [
        recipient({ id: 'sms-son', channel: 'sms', phone: '+972500000001' }),
        recipient({ id: 'email-abroad', channel: 'email', email: 'dana@example.com' }),
      ],
    });
    expect(result.due[0]?.targets).toEqual([
      { recipientId: 'sms-son', name: 'Dana', channel: 'sms', contact: '+972500000001' },
      { recipientId: 'email-abroad', name: 'Dana', channel: 'email', contact: 'dana@example.com' },
    ]);
  });

  it('does not report a due reminder when nobody can be told, and says why', () => {
    const result = plan({ recipients: [recipient({ consentAt: '' })] });
    expect(result.due).toHaveLength(0);
    expect(result.skippedMedications).toEqual([
      { medicationId: 'med-1', slot: 'morning', reason: 'no-eligible-recipients' },
    ]);
    expect(result.skippedRecipients).toHaveLength(1);
  });
});

describe('notification intent drafts', () => {
  it('never carries the medication name, dosage or notes', () => {
    const result = plan({
      medications: [
        medication({ name: 'Eliquis', dosage: '5mg twice daily', notes: 'after food' }),
      ],
    });
    const serialised = JSON.stringify(result.due[0]?.intents);
    expect(serialised).not.toContain('Eliquis');
    expect(serialised).not.toContain('5mg');
    expect(serialised).not.toContain('after food');
  });

  it('fills every notification_intent field the server does not own', () => {
    expect(plan().due[0]?.intents).toEqual([
      {
        recipientType: 'family_member',
        recipientRef: 'rec-1',
        recipientName: 'Dana',
        eventType: REMINDER_EVENT_TYPE,
        templateKey: REMINDER_TEMPLATE_KEY,
        templateVersion: REMINDER_TEMPLATE_VERSION,
        locale: 'he',
        authenticatedPath: REMINDER_APP_PATH,
        idempotencyKey: 'medication:med-1:morning:2026-08-20:rec-1',
        templateVariables: { slot: 'morning', slotTime: '08:00', localDate: '2026-08-20' },
        destinationByChannel: { sms: '+972501234567' },
        preference: {
          emailEnabled: false,
          whatsappEnabled: false,
          smsEnabled: true,
          preferredChannel: 'sms',
          preferredLocale: 'he',
          whatsappConsent: 'unknown',
          smsConsent: 'granted',
        },
      },
    ]);
  });

  it('carries a template key and version rather than rendered text', () => {
    const intent = plan().due[0]?.intents[0];
    expect(intent?.templateKey).toBe('medication.dose_due');
    expect(intent?.templateVersion).toBe(1);
  });

  it('links to an authenticated in-app path, as the intent contract requires', () => {
    expect(plan().due[0]?.intents[0]?.authenticatedPath).toMatch(/^\//);
  });

  it('gives each recipient its own idempotency key so one send cannot swallow another', () => {
    const result = plan({
      recipients: [recipient({ id: 'rec-1' }), recipient({ id: 'rec-2' })],
    });
    expect(result.due[0]?.intents.map((intent) => intent.idempotencyKey)).toEqual([
      'medication:med-1:morning:2026-08-20:rec-1',
      'medication:med-1:morning:2026-08-20:rec-2',
    ]);
  });

  it('enables only the channel the recipient chose, per recipient', () => {
    const result = plan({
      recipients: [
        recipient({ id: 'sms-son', channel: 'sms', phone: '+972500000001' }),
        recipient({ id: 'email-abroad', channel: 'email', email: 'dana@example.com' }),
      ],
    });
    expect(result.due[0]?.intents.map((intent) => intent.destinationByChannel)).toEqual([
      { sms: '+972500000001' },
      { email: 'dana@example.com' },
    ]);
    expect(result.due[0]?.intents.map((intent) => intent.preference.preferredChannel)).toEqual([
      'sms',
      'email',
    ]);
  });

  it('renders in the locale the caller asked for', () => {
    const result = plan({ locale: 'en' });
    expect(result.due[0]?.intents[0]?.locale).toBe('en');
    expect(result.due[0]?.intents[0]?.preference.preferredLocale).toBe('en');
  });
});

describe('plan bookkeeping', () => {
  it('records the local wall clock it decided against', () => {
    const result = plan();
    expect(result.localDate).toBe('2026-08-20');
    expect(result.localTime).toBe('08:05');
    expect(result.quietHours).toBe(false);
  });

  it('returns an empty plan for an empty household without throwing', () => {
    const result = plan({ medications: [], recipients: [] });
    expect(result.due).toEqual([]);
    expect(result.skippedMedications).toEqual([]);
    expect(result.skippedRecipients).toEqual([]);
  });
});

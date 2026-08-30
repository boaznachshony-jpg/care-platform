import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  canReceiveReminders,
  readMvpReminderRecipients,
  reminderContactFor,
  saveMvpReminderRecipients,
  REMINDER_CHANNELS,
  type MvpReminderRecipient,
} from './mvp-storage.js';

/**
 * The rule these tests protect: nobody is contacted about someone else's
 * medication unless they said yes, they are still active, and the channel they
 * chose has somewhere to deliver to.
 *
 * The channel is per recipient because of a failure that is invisible when it
 * happens: a family member abroad on an eSIM data plan has internet but no
 * cellular line, so an SMS is accepted by the network and never arrives. A
 * single account-wide channel would fail exactly the person the household is
 * counting on, silently.
 */

function recipient(overrides: Partial<MvpReminderRecipient> = {}): MvpReminderRecipient {
  return {
    id: 'r1',
    name: 'נועה',
    relationship: 'בת',
    phone: '+972500000000',
    email: 'noa@example.com',
    channel: 'sms',
    consentAt: '2026-08-29T18:00:00.000Z',
    consentBy: 'boaz',
    active: true,
    updatedAt: '2026-08-29T18:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('reminderContactFor', () => {
  it('delivers to the phone for sms and whatsapp, and to the address for email', () => {
    expect(reminderContactFor(recipient({ channel: 'sms' }))).toBe('+972500000000');
    expect(reminderContactFor(recipient({ channel: 'whatsapp' }))).toBe('+972500000000');
    expect(reminderContactFor(recipient({ channel: 'email' }))).toBe('noa@example.com');
  });

  it('treats whitespace as absent, so a blank field cannot look like an address', () => {
    expect(reminderContactFor(recipient({ channel: 'sms', phone: '   ' }))).toBe('');
  });
});

describe('canReceiveReminders', () => {
  it('allows a consenting, active recipient who has a usable address', () => {
    expect(canReceiveReminders(recipient())).toBe(true);
  });

  it('refuses a recipient who never consented', () => {
    expect(canReceiveReminders(recipient({ consentAt: '' }))).toBe(false);
  });

  it('refuses a recipient who was paused, without erasing their consent record', () => {
    const paused = recipient({ active: false });
    expect(canReceiveReminders(paused)).toBe(false);
    expect(paused.consentAt).not.toBe('');
  });

  it('refuses when the chosen channel has no address, even if the other one does', () => {
    // The daughter abroad: an email on file, but she picked SMS and has no line.
    expect(canReceiveReminders(recipient({ channel: 'sms', phone: '' }))).toBe(false);
    // And the mirror case, which is the one that catches a bad form.
    expect(canReceiveReminders(recipient({ channel: 'email', email: '' }))).toBe(false);
  });

  it('is not satisfied by a phone number when the channel is email', () => {
    expect(
      canReceiveReminders(recipient({ channel: 'email', email: '', phone: '+972500000000' })),
    ).toBe(false);
  });
});

describe('storage round trip', () => {
  it('reads back what was saved', () => {
    saveMvpReminderRecipients([
      recipient(),
      recipient({ id: 'r2', name: 'איתי', channel: 'whatsapp' }),
    ]);
    const stored = readMvpReminderRecipients();
    expect(stored).toHaveLength(2);
    expect(stored[1]?.channel).toBe('whatsapp');
  });

  it('returns an empty list rather than throwing when nothing was ever saved', () => {
    expect(readMvpReminderRecipients()).toEqual([]);
  });

  it('offers exactly the three channels the product supports today', () => {
    expect([...REMINDER_CHANNELS]).toEqual(['sms', 'whatsapp', 'email']);
  });
});

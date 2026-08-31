import { describe, expect, it } from 'vitest';
import { deriveComplianceStatus } from './manage-case-documents.js';

/**
 * DOM-17. An Israeli permit states a LAST VALID DATE (תוקף עד). It was stored
 * as `2026-09-01T00:00:00.000Z` and compared with `expiry <= now`, so from
 * 03:00 that morning Israel time — for essentially the whole of its final valid
 * day — a valid permit read as expired. In this product that is an unnecessary
 * escalation and an unnecessary call to the bureau.
 *
 * Each assertion below fails against the old comparison.
 */
describe('deriveComplianceStatus', () => {
  const expiresAt = '2026-09-01T00:00:00.000Z';

  it('is still valid at the stored instant itself, which is 03:00 in Israel', () => {
    expect(deriveComplianceStatus(expiresAt, new Date('2026-09-01T00:00:00.000Z'))).not.toBe(
      'expired',
    );
  });

  it('is still valid late in the evening of its final valid day', () => {
    // 23:00 Israel time on 1 September (summer, UTC+3).
    expect(deriveComplianceStatus(expiresAt, new Date('2026-09-01T20:00:00.000Z'))).not.toBe(
      'expired',
    );
  });

  it('expires exactly when the next Israeli day begins', () => {
    expect(deriveComplianceStatus(expiresAt, new Date('2026-09-01T21:00:00.000Z'))).toBe('expired');
  });

  it('still warns inside the 30-day window and stays valid outside it', () => {
    expect(deriveComplianceStatus(expiresAt, new Date('2026-08-20T09:00:00.000Z'))).toBe(
      'expiring',
    );
    expect(deriveComplianceStatus(expiresAt, new Date('2026-06-01T09:00:00.000Z'))).toBe('valid');
  });

  it('treats a missing or unusable expiry as valid rather than throwing on a read path', () => {
    expect(deriveComplianceStatus(null, new Date())).toBe('valid');
    expect(deriveComplianceStatus('not-a-date', new Date())).toBe('valid');
  });

  /**
   * The production-data question: a row written before this change stored the
   * same UTC-midnight instant, and UTC midnight is 02:00/03:00 inside the
   * Israeli day it names. So every existing row resolves to the same calendar
   * day it was entered as; nothing is reinterpreted, the day is simply honoured
   * to its end.
   */
  it('reads a legacy winter row as the calendar day it was entered as', () => {
    // 2026-01-15 stored at UTC midnight = 02:00 on the 15th in Israel.
    const winter = '2026-01-15T00:00:00.000Z';
    expect(deriveComplianceStatus(winter, new Date('2026-01-15T21:00:00.000Z'))).not.toBe(
      'expired',
    );
    expect(deriveComplianceStatus(winter, new Date('2026-01-15T22:00:00.000Z'))).toBe('expired');
  });
});

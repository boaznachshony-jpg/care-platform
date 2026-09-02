/**
 * Shared "how many days until this date" logic.
 *
 * WHY naive subtraction is wrong here:
 * A plain `new Date(isoDate)` parses a date-only string ("2026-09-03") as
 * midnight UTC, while `new Date()` / `Date.now()` is an instant in the
 * browser's local time. Subtracting the two mixes a UTC clock reading with a
 * local one: at any given local moment there is a 2-3 hour gap (Israel is
 * UTC+2/+3) between "midnight UTC of the due date" and "the same wall-clock
 * moment locally". That gap is enough to push a `Math.ceil`/`Math.floor` of
 * the millisecond difference across a whole-day boundary, so the very same
 * expiry date can report "today" on one screen and "tomorrow" (or
 * "yesterday") on another, purely depending on what time of day the family
 * happens to load the page. For a product whose entire job is to say
 * accurately what is about to expire, that is not a rounding detail.
 *
 * The fix: anchor *both* sides of the subtraction to local noon of their
 * respective calendar day before subtracting. Noon is exactly half a day
 * away from both the previous and next midnight, so no timezone offset used
 * anywhere in the world (nor a DST-shortened/lengthened day, which is 23 or
 * 25 hours rather than 24) can push the anchored instant into a neighbouring
 * calendar day. The result is always the true number of *calendar* days
 * between the two dates - the number a person reading a wall calendar would
 * count - never a same-day flip caused by the clock.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Local noon of the calendar day a given `Date` falls on, in local time. */
function localNoonOf(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

/**
 * Parses a date value as local noon of the calendar day it represents.
 *
 * - `yyyy-mm-dd` strings (what every date `<input>` in this app produces)
 *   are read literally as *that* local calendar day - never routed through
 *   UTC parsing, which is the mistake this module exists to avoid.
 * - Any other Date-parseable value (e.g. a full ISO timestamp from
 *   `toISOString()`) is first resolved to a real instant, then converted to
 *   *its* local calendar day. This keeps the function usable for the rarer
 *   callers that carry a precise instant rather than a plain date.
 *
 * Returns `null` for anything that doesn't parse - callers decide what "no
 * date" means for their own screen; it is never the same as "expired".
 */
export function localNoonFromDateValue(value: string): Date | null {
  const raw = DATE_ONLY_PATTERN.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(raw.getTime()) ? null : localNoonOf(raw);
}

/**
 * Whole calendar days from `today` to `value` (0 = today, negative = past).
 * `today` defaults to the real current time; tests should pass a fixed Date.
 * Returns `null` when `value` doesn't parse to a date at all.
 */
export function daysUntil(value: string, today: Date = new Date()): number | null {
  const due = localNoonFromDateValue(value);
  if (!due) return null;
  const start = localNoonOf(today);
  return Math.round((due.getTime() - start.getTime()) / MS_PER_DAY);
}

/** The app-wide expiry windows: "urgent" inside two weeks, "soon" inside a month. */
export const URGENT_WINDOW_DAYS = 14;
export const SOON_WINDOW_DAYS = 30;

export type ExpiryClassification = 'no-date' | 'expired' | 'urgent' | 'soon' | 'ok';

/** Severity bucket for an already-computed day count, using the shared windows. */
export function expirySeverity(days: number): 'urgent' | 'soon' | 'ok' {
  if (days < URGENT_WINDOW_DAYS) return 'urgent';
  if (days < SOON_WINDOW_DAYS) return 'soon';
  return 'ok';
}

/**
 * Classifies a date against the shared 14/30-day windows.
 *
 * `'no-date'` is deliberately not `'ok'` or `'expired'`: a missing expiry
 * date (many document types genuinely have none - a bank confirmation letter
 * never expires) carries no information about validity either way, and
 * collapsing it into either bucket would be a claim the data doesn't
 * support.
 */
export function classifyExpiry(
  value: string | null | undefined,
  today: Date = new Date(),
): ExpiryClassification {
  if (!value) return 'no-date';
  const days = daysUntil(value, today);
  if (days === null) return 'no-date';
  if (days < 0) return 'expired';
  return expirySeverity(days);
}

const ISO_DATE_IN_TEXT = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const DISPLAY_DATE_IN_TEXT = /\b(\d{2})[./](\d{2})[./](\d{4})\b/;

/**
 * Pulls an ISO (`yyyy-mm-dd`) expiry date out of a free-text label such as
 * "בתוקף עד 31.12.2027" or a raw ISO string embedded in a longer string.
 * Shared so every screen that reads `MvpDocument.dateLabel` agrees on what
 * counts as the document's expiry date.
 */
export function extractIsoDateFromLabel(label: string): string | null {
  const iso = label.match(ISO_DATE_IN_TEXT);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const display = label.match(DISPLAY_DATE_IN_TEXT);
  return display ? `${display[3]}-${display[2]}-${display[1]}` : null;
}

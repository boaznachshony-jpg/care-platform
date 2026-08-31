/**
 * Root 8 — the one date type, with an explicit time zone.
 *
 * DOM-03 / DOM-17. Three separate defects, one cause: the code asked the host
 * what day it was.
 *
 *   DOM-03. The quarterly national-insurance deadline read
 *   `getFullYear/getMonth/getDate` off a `new Date()` — the HOST's local zone.
 *   On a UTC server at 00:30 Israel time on 16 April the computed "today" is
 *   still 15 April, so a payment that is legally late is reported as due
 *   today; on a UTC-5 browser the mirror image happens. Israel is UTC+2/+3, so
 *   that is a two-to-three hour window of a wrong legal status every single
 *   day, on a deadline that carries interest and penalties.
 *
 *   DOM-17. A calendar-day expiry (`2026-09-01`, תוקף עד) is stored at
 *   `2026-09-01T00:00:00.000Z` and compared with `expiry <= now`. That instant
 *   is 02:00 or 03:00 Israel time on 1 September, so a still-valid permit reads
 *   as expired for essentially the whole of its final valid day.
 *
 * THE RULE
 * --------
 * **Asia/Jerusalem is the business time zone.** An employment record, a permit,
 * a payroll month and a national-insurance deadline are anchored to Israeli
 * calendar days regardless of where the server is racked or where the person
 * holding the phone is standing. The host's local zone never decides anything.
 *
 * This module is the server-side half of a decision the client already made:
 * `apps/web/src/format-timestamp.ts` pins the same zone for display. Same zone
 * constant, same reasoning, opposite ends of the wire.
 *
 * BOUNDARY SEMANTICS, SETTLED ONCE
 * --------------------------------
 * A stored calendar date is the **last valid day**, not the first invalid one.
 * That is what תוקף עד means on an Israeli permit and what a due date means on
 * a task. So the instant a date stops being current is
 * `israelEndOfDayExclusive(date)` — midnight at the START of the following day,
 * Israel time. `israelStartOfDay` exists for the opposite question ("has this
 * begun?") and the two are never mixed.
 *
 * DST is handled by asking the platform's IANA database rather than by adding
 * two hours: Israel's transitions move, and 2024 is not 2026.
 */

export const ISRAEL_TIME_ZONE = 'Asia/Jerusalem';

/** A calendar day in the business time zone, serialised as YYYY-MM-DD. */
export type IsraelDate = string & { readonly __israelDate: unique symbol };

export type DateProblem = 'not_a_date' | 'not_calendar_valid' | 'not_an_instant';

export class BusinessDateError extends Error {
  constructor(
    readonly problem: DateProblem,
    readonly received: unknown,
  ) {
    super(`business date is ${problem}`);
    this.name = 'BusinessDateError';
  }
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validate and brand a YYYY-MM-DD string.
 *
 * A full timestamp is REFUSED rather than truncated. DOM-18 is what truncation
 * silently produces: `effectiveUntil < asOf` compared `'2026-01-01'` with
 * `'2026-01-01T10:00:00Z'` as strings and declared the rule expired on its own
 * final valid day. Callers that hold an instant must say so by going through
 * `israelDateOf`, which makes the zone conversion visible.
 */
export function israelDate(value: string): IsraelDate {
  const parts = DATE_ONLY.exec(value);
  if (!parts) throw new BusinessDateError('not_a_date', value);
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new BusinessDateError('not_calendar_valid', value);
  }
  return value as IsraelDate;
}

/**
 * Accepts either a plain date or a full ISO timestamp, and returns the Israeli
 * calendar day. Use this at the boundary where a stored `timestamptz` or an
 * `asOf` parameter of unknown shape has to become a business day.
 */
export function toIsraelDate(value: string | Date | number): IsraelDate {
  if (typeof value === 'string' && DATE_ONLY.test(value)) return israelDate(value);
  return israelDateOf(value);
}

const ZONED_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: ISRAEL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

interface ZonedFields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function toInstant(value: Date | string | number): Date {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) throw new BusinessDateError('not_an_instant', value);
  return instant;
}

function zonedFields(instant: Date): ZonedFields {
  const parts = ZONED_PARTS.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
  // Some ICU builds render midnight as hour 24 under hour12:false. Both
  // readings mean the same instant; normalising here keeps the arithmetic below
  // from landing a day late.
  const hour = read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
    second: read('second'),
  };
}

/**
 * The zone's offset from UTC, in milliseconds, at a given instant. Derived from
 * the platform's IANA database, so a summer instant gets +3 and a winter one
 * +2 without this file knowing when Israel switches.
 */
export function israelOffsetMs(instant: Date | string | number): number {
  const moment = toInstant(instant);
  const fields = zonedFields(moment);
  const asUtc = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute,
    fields.second,
  );
  // The formatter drops milliseconds; adding them back keeps the offset an
  // exact whole-minute value rather than one that wobbles by up to 999ms.
  return asUtc - (moment.getTime() - moment.getMilliseconds());
}

/** The Israeli calendar day an instant falls on. This replaces every `localIso()`. */
export function israelDateOf(instant: Date | string | number): IsraelDate {
  const fields = zonedFields(toInstant(instant));
  const month = String(fields.month).padStart(2, '0');
  const day = String(fields.day).padStart(2, '0');
  return `${fields.year}-${month}-${day}` as IsraelDate;
}

/** The instant at which a business day begins (00:00 Israel time). */
export function israelStartOfDay(date: IsraelDate): Date {
  const [year, month, day] = date.split('-').map(Number);
  const naive = Date.UTC(year!, month! - 1, day!);
  // Two passes: the first offset is read at an instant that may sit on the far
  // side of a DST transition, the second at one that cannot. Israel switches at
  // 02:00, so local midnight always exists and always occurs exactly once —
  // there is no gap or repeat for this particular wall clock to fall into.
  const first = naive - israelOffsetMs(new Date(naive));
  const second = naive - israelOffsetMs(new Date(first));
  return new Date(second);
}

/**
 * The instant at which a business day ENDS — i.e. the start of the next day.
 * Exclusive on purpose: a stored date is the last valid day, so `now >= this`
 * is the one correct test for "expired" / "overdue", and `now < this` for
 * "still valid".
 */
export function israelEndOfDayExclusive(date: IsraelDate): Date {
  return israelStartOfDay(addIsraelDays(date, 1));
}

/** Whether the last valid day has fully passed in the business time zone (DOM-17). */
export function isAfterIsraelDay(instant: Date | string | number, date: IsraelDate): boolean {
  return toInstant(instant).getTime() >= israelEndOfDayExclusive(date).getTime();
}

export function addIsraelDays(date: IsraelDate, days: number): IsraelDate {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return israelDateOf(
    new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 12)),
  );
}

/** Whole days from `from` to `to`, counted on the calendar, never on elapsed hours. */
export function israelDaysBetween(from: IsraelDate, to: IsraelDate): number {
  const day = (value: IsraelDate): number => {
    const [year, month, date] = value.split('-').map(Number);
    return Date.UTC(year!, month! - 1, date!) / 86_400_000;
  };
  return day(to) - day(from);
}

export function compareIsraelDates(left: IsraelDate, right: IsraelDate): number {
  // Fixed-width, zero-padded, big-endian: lexicographic order IS chronological
  // order. Guaranteed by israelDate(), which is the only way to make one.
  return left < right ? -1 : left > right ? 1 : 0;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Advance a date by whole months, keeping the ORIGINAL day of the month as the
 * anchor.
 *
 * DOM-16. `date + interval '1 month'` in Postgres clamps to the last valid day
 * (`2026-01-31` -> `2026-02-28`) and the next advance is computed from the
 * clamped value, so a subscription anchored on the 31st permanently migrates to
 * the 28th after its first February and charges every subsequent customer three
 * days early forever. The fix is not different arithmetic, it is a different
 * anchor: the intended day-of-month is remembered, clamping applies to the
 * short month ONLY, and the following month returns to the anchor.
 */
export function addIsraelMonthsAnchored(
  from: IsraelDate,
  months: number,
  anchorDay: number,
): IsraelDate {
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
    throw new BusinessDateError('not_calendar_valid', anchorDay);
  }
  const [year, month] = from.split('-').map(Number);
  const target = new Date(Date.UTC(year!, month! - 1 + months, 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth() + 1;
  const day = Math.min(anchorDay, daysInMonth(targetYear, targetMonth));
  return israelDate(
    `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  );
}

/** The day-of-month a recurring schedule is anchored on. */
export function anchorDayOf(date: IsraelDate): number {
  return Number(date.slice(8, 10));
}

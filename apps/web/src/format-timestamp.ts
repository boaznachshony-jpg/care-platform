/**
 * Shared timestamp formatting for transaction rows.
 *
 * Every money movement the user sees on screen (a payroll close, a saved
 * monthly record, a payment to the caregiver, an acknowledgement) carries a
 * moment in time. Showing only the month or only the date hides *when the
 * action was actually taken*, which is exactly what the user needs when two
 * records disagree or when proving what was done and when.
 *
 * Israel-first: he-IL locale, 24-hour clock, day-first order.
 */

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('he-IL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const DATE_FORMATTER = new Intl.DateTimeFormat('he-IL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    // A bare "2026-08-01" is parsed by the spec as UTC midnight, which renders
    // as the previous day for anyone west of UTC. A payment date has no time
    // component at all, so interpret it as a local calendar day.
    const parts = DATE_ONLY.exec(value);
    if (parts) {
      const local = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
      return Number.isNaN(local.getTime()) ? null : local;
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * "21.08.2026, 14:32" - full date and time. Returns null when the value is
 * missing or unparseable so callers can simply omit the element.
 */
export function formatDateTime(value: string | number | Date | null | undefined): string | null {
  const date = toDate(value);
  return date ? DATE_TIME_FORMATTER.format(date) : null;
}

/** "21.08.2026" - date only, for date-only fields such as a payment date. */
export function formatDateOnly(value: string | number | Date | null | undefined): string | null {
  const date = toDate(value);
  return date ? DATE_FORMATTER.format(date) : null;
}

/**
 * The machine-readable value for a <time dateTime={...}> attribute: the
 * original ISO string when it is valid, so assistive tech and any future
 * export keep full precision regardless of how we display it.
 */
export function toIsoAttribute(value: string | number | Date | null | undefined): string | null {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

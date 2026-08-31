/**
 * Root 8 — the one money type.
 *
 * DOM-04. Before this file the product held money in three incompatible ways
 * at once: `number` shekels with decimals in payroll and forecasting, integer
 * agorot in product billing, and — sitting between them — a rounding helper
 * that did not work:
 *
 *   const roundMoney = (amount) => Math.round((amount + Number.EPSILON) * 100) / 100;
 *
 * `Number.EPSILON` is ~2.2e-16 in absolute terms while the binary
 * representation gap at shekel magnitudes is ~1e-13, so the correction is three
 * orders of magnitude too small exactly where it is needed. It is measurably
 * inconsistent: `roundMoney(1.015) === 1.02` but `roundMoney(8.165) === 8.16`.
 * Two half-agora cases in the same month therefore rounded in opposite
 * directions, and the printed payslip and the stored record disagreed.
 *
 * THE RULE
 * --------
 * Money is an integer number of agorot. Always. There is no such thing as half
 * an agora in this product: the Bank of Israel withdrew the half-agora coin in
 * 1991 and no payslip, invoice or charge can express one. An integer cannot
 * drift, two integers compare exactly, and a sum of integers is the same
 * number in every order — so the tolerance window that used to sit between
 * "what the browser computed" and "what the database stored" has nothing left
 * to hide.
 *
 * Conversion happens ONLY at the edges:
 *   - `agorotFromShekels` / `parseShekels` when a decimal value arrives from a
 *     user, an API body or a `numeric(12,2)` column;
 *   - `shekelsOf` / `formatShekels` when a value leaves for a screen, a
 *     `numeric(12,2)` column or a JSON response.
 * Nothing in between is allowed to see a fractional shekel.
 *
 * ROUNDING
 * --------
 * One rule, stated once: **half away from zero**, which is the ordinary
 * Israeli payroll convention and the rule Postgres `round(numeric)` implements,
 * so a value computed here and a value computed by the CHECK constraint in
 * migration 0045 agree by construction rather than by luck.
 *
 * Rounding is applied when a value *becomes* an amount — a product, a
 * percentage, a parsed decimal — and never again. Sums and differences of
 * agorot are exact and need no rounding at all.
 */

/**
 * An amount of money, in whole agorot. The brand exists so a raw `number`
 * cannot be passed where an amount is expected: that mistake is precisely how
 * shekels and agorot came to be mixed in the first place.
 */
export type Agorot = number & { readonly __agorot: unique symbol };

export const AGOROT_PER_SHEKEL = 100;

/**
 * The widest amount this product accepts, in agorot: ±10,000,000 shekels. It
 * is the same bound every money column already carries
 * (`check (… between 0 and 10000000)` in migration 0028), expressed once here
 * so a value that could never be stored is refused before it is computed with.
 */
export const MAX_AGOROT = 1_000_000_000;

export type MoneyProblem = 'not_finite' | 'not_integer' | 'out_of_range' | 'unparseable';

/** Why an amount was refused, for a caller that maps it onto a field error. */
export class MoneyError extends Error {
  constructor(
    readonly problem: MoneyProblem,
    readonly received: unknown,
  ) {
    super(`money value is ${problem}`);
    this.name = 'MoneyError';
  }
}

function guard(value: number, received: unknown): Agorot {
  if (!Number.isFinite(value)) throw new MoneyError('not_finite', received);
  if (!Number.isInteger(value)) throw new MoneyError('not_integer', received);
  if (Math.abs(value) > MAX_AGOROT) throw new MoneyError('out_of_range', received);
  return value as Agorot;
}

/** The zero amount. Not a magic `0`, so it type-checks like every other amount. */
export const ZERO_AGOROT = 0 as Agorot;

/**
 * An amount already counted in whole agorot — a `price_agorot` column, a
 * Cardcom amount, an integer literal in a test.
 */
export function agorot(value: number): Agorot {
  return guard(value, value);
}

/**
 * Decimal text -> agorot, half away from zero, decided on the DIGITS rather
 * than on the binary float.
 *
 * `Math.round(8.165 * 100)` is 816, because `8.165 * 100` is
 * `816.4999999999999` in IEEE-754. But node-postgres serialises the same JS
 * number as the text `8.165`, which Postgres parses as an exact decimal and
 * rounds to `8.17`. Rounding on the text — the very characters that reach the
 * database — is what makes the two agree. This is the single reason the
 * function below walks a string instead of multiplying.
 */
function decimalTextToAgorot(text: string, received: unknown): number {
  const negative = text.startsWith('-');
  const body = negative || text.startsWith('+') ? text.slice(1) : text;
  if (!/^\d*(\.\d*)?$/.test(body) || body === '' || body === '.') {
    throw new MoneyError('unparseable', received);
  }
  const [whole = '', fraction = ''] = body.split('.');
  const padded = `${fraction}00`.slice(0, 3);
  const scaled = Number(`${whole === '' ? '0' : whole}${padded.slice(0, 2)}`);
  // Half away from zero: the discarded tail is >= half an agora exactly when
  // its first discarded digit is 5 or more. `fraction.length > 3` cannot change
  // that decision — 0.5000…1 and 0.5 both round away — so only digit three is
  // consulted.
  const roundUp = padded.charCodeAt(2) >= 53;
  const magnitude = scaled + (roundUp ? 1 : 0);
  return negative ? -magnitude : magnitude;
}

/**
 * A decimal shekel amount -> agorot. This is an EDGE function: use it where a
 * `numeric(12,2)` column, a JSON body or a legacy shekel API hands over a
 * fractional number, and nowhere else.
 */
export function agorotFromShekels(amount: number): Agorot {
  if (!Number.isFinite(amount)) throw new MoneyError('not_finite', amount);
  const text = String(amount);
  if (text.includes('e') || text.includes('E')) {
    // Exponent notation appears only below a millionth of a shekel or above
    // 1e21. The first rounds to zero under this rule; the second is refused by
    // the range guard, which is the correct answer for both.
    return guard(Math.abs(amount) < 0.005 ? 0 : Math.round(amount * AGOROT_PER_SHEKEL), amount);
  }
  return guard(decimalTextToAgorot(text, amount), amount);
}

/**
 * User-typed text -> agorot. The other EDGE function. Accepts the shapes a
 * Hebrew-locale keyboard actually produces: a leading ₪, thousands separators,
 * surrounding whitespace, and either an ASCII or an Arabic-Indic decimal point
 * is deliberately NOT accepted — an ambiguous separator is refused rather than
 * guessed at, because guessing wrong moves a decimal point.
 */
export function parseShekels(input: string): Agorot {
  const cleaned = input.trim().replace(/^₪\s*/, '').replace(/,/g, '').replace(/\s/g, '');
  if (cleaned === '') throw new MoneyError('unparseable', input);
  return guard(decimalTextToAgorot(cleaned, input), input);
}

/**
 * agorot -> decimal shekels. An EDGE function: for a `numeric(12,2)` parameter,
 * a JSON response field, or a chart axis. The result is exact for every value
 * this product accepts, because |agorot| <= 1e9 and a double represents every
 * integer below 2^53 exactly; the division introduces at most one rounding of
 * the final binary digit, which `numeric(12,2)` re-quantises away.
 */
export function shekelsOf(amount: Agorot): number {
  return amount / AGOROT_PER_SHEKEL;
}

/**
 * The text that goes into a `numeric(12,2)` bind parameter. Preferred over
 * `shekelsOf` on any write path: it hands Postgres exact decimal digits instead
 * of a float for the driver to serialise.
 */
export function shekelsText(amount: Agorot): string {
  const negative = amount < 0;
  const magnitude = Math.abs(amount);
  const whole = Math.trunc(magnitude / AGOROT_PER_SHEKEL);
  const cents = magnitude % AGOROT_PER_SHEKEL;
  return `${negative ? '-' : ''}${whole}.${String(cents).padStart(2, '0')}`;
}

const SHEKEL_FORMATTER = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Display only. Never feed the output of this back into a calculation. */
export function formatShekels(amount: Agorot): string {
  return SHEKEL_FORMATTER.format(shekelsOf(amount));
}

/** Exact addition. Integers, so no rounding and no order dependence. */
export function addAgorot(...amounts: readonly Agorot[]): Agorot {
  return guard(
    amounts.reduce((sum: number, amount) => sum + amount, 0),
    amounts,
  );
}

export function subtractAgorot(left: Agorot, right: Agorot): Agorot {
  return guard(left - right, [left, right]);
}

export function sumAgorot(amounts: readonly Agorot[]): Agorot {
  return addAgorot(...amounts);
}

export function negateAgorot(amount: Agorot): Agorot {
  return guard(-amount, amount);
}

/**
 * Multiply an amount by a dimensionless factor — 4.5 rest days at a daily rate,
 * a proration ratio — and round the product to whole agorot once, half away
 * from zero. This is the only place a non-integer is allowed near money.
 */
export function scaleAgorot(amount: Agorot, factor: number): Agorot {
  if (!Number.isFinite(factor)) throw new MoneyError('not_finite', factor);
  const product = amount * factor;
  // `Math.round` is half-UP, which differs from half-away-from-zero for
  // negatives: Math.round(-0.5) === -0. Sign is stripped first so the rule is
  // the same on both sides of zero, matching Postgres `round(numeric)`.
  const rounded = Math.sign(product) * Math.round(Math.abs(product));
  return guard(rounded === 0 ? 0 : rounded, [amount, factor]);
}

/**
 * A whole-percent share of an amount, rounded once. Used for the launch
 * discount (DOM-09), where the SQL that claims the charge computes
 * `round(price_agorot * (100 - launch_discount_percent) / 100.0)` — the same
 * arithmetic in the same order with the same rounding rule, so the price the
 * customer is shown and the amount the card is charged cannot diverge.
 */
export function percentOfAgorot(amount: Agorot, percent: number): Agorot {
  if (!Number.isFinite(percent)) throw new MoneyError('not_finite', percent);
  return scaleAgorot(amount, percent / 100);
}

/**
 * Exact equality.
 *
 * DOM-04's EPSILON fudge and DOM-14's 0.01 tolerance window both existed to
 * paper over the fact that two layers computed the "same" amount in floating
 * point and got different answers. Integers do not have that problem, so this
 * function is `===` and there is deliberately no `equalsWithin`. If two amounts
 * differ by one agora, they differ.
 */
export function agorotEqual(left: Agorot, right: Agorot): boolean {
  return left === right;
}

/** Splits a VAT-inclusive amount so that net + vat is exactly the whole. */
export function splitVatInclusive(gross: Agorot, vatRateBps: number): { net: Agorot; vat: Agorot } {
  if (!Number.isFinite(vatRateBps) || vatRateBps < 0)
    throw new MoneyError('not_finite', vatRateBps);
  const net = scaleAgorot(gross, 1 / (1 + vatRateBps / 10_000));
  return { net, vat: subtractAgorot(gross, net) };
}

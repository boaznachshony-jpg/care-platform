/**
 * Root 8 — the price a subscription is charged, and the day it is charged on.
 *
 * Two findings, one shape: a number the customer is SHOWN was computed in one
 * language and layer, and the number the customer is CHARGED was computed in
 * another, with nothing tying them together.
 *
 *   DOM-09. `manage-product-billing.ts` advertised
 *   `effectivePriceAgorot = round(price * (1 - launchDiscountPercent / 100))`,
 *   while the SQL that actually claims due charges selected only rows
 *   `where s.launch_discount_percent = 0` and billed the UNDISCOUNTED
 *   `price_agorot`. So a partial discount existed in exactly two states as far
 *   as money was concerned: 0 (charged in full) or anything else (never charged
 *   at all). Set a tenant to 40%: the billing page shows a 60% price and a next
 *   charge date, the access-state derivation treats the tenant as needing
 *   payment, and the collection job never picks the row up. The customer is
 *   billed ₪0 indefinitely while being told otherwise.
 *
 *   DOM-16. `next_charge_on = (v_period + interval '1 month')::date` clamps to
 *   the last valid day of a short month and then chains from the clamped value,
 *   so a subscription anchored on the 29th, 30th or 31st permanently migrates
 *   to the 28th after its first February and charges every subsequent customer
 *   two to three days early forever.
 *
 * Both are fixed by computing from one place. `effectivePriceAgorot` below is
 * the arithmetic the SQL in migration 0045 performs, digit for digit, and
 * `nextChargeOn` is anchored on a stored day-of-month rather than on the
 * previous charge. A test asserts the displayed price equals the claimed
 * amount for the same subscription row.
 */

import { addIsraelMonthsAnchored, anchorDayOf, israelDate, type IsraelDate } from './date.js';
import { agorot, MoneyError, type Agorot } from './money.js';

/**
 * The amount actually charged for one month, in whole agorot.
 *
 * Deliberately integer arithmetic rather than `price * (1 - percent / 100)`:
 * the SQL computes `round(price_agorot * (100 - launch_discount_percent) /
 * 100.0)` on `numeric`, which is exact decimal, and the only way to be certain
 * a float expression agrees with it in every case is not to use one.
 * `price_agorot * (100 - percent)` is at most 1e11, comfortably inside the
 * 2^53 range where a double represents every integer exactly.
 *
 * Rounding is half away from zero, matching `round(numeric)` and `scaleAgorot`.
 */
export function effectivePriceAgorot(priceAgorot: Agorot, launchDiscountPercent: number): Agorot {
  if (!Number.isInteger(launchDiscountPercent)) {
    throw new MoneyError('not_integer', launchDiscountPercent);
  }
  if (launchDiscountPercent < 0 || launchDiscountPercent > 100) {
    throw new MoneyError('out_of_range', launchDiscountPercent);
  }
  const product = priceAgorot * (100 - launchDiscountPercent);
  const magnitude = Math.abs(product);
  const rounded = Math.trunc(magnitude / 100) + (magnitude % 100 >= 50 ? 1 : 0);
  return agorot(product < 0 ? -rounded : rounded);
}

/**
 * Whether this subscription has anything to collect at all.
 *
 * A 100% discount is a sponsored account: the effective price is zero, there is
 * no charge to make, and the collection job must skip it — which is what the
 * old `launch_discount_percent = 0` filter accidentally got right for exactly
 * one of the 101 possible values.
 */
export function isCollectable(priceAgorot: Agorot, launchDiscountPercent: number): boolean {
  return effectivePriceAgorot(priceAgorot, launchDiscountPercent) > 0;
}

/**
 * The next monthly charge date, anchored on the subscription's intended
 * day-of-month.
 *
 * `anchorDay` is the day the schedule was originally set to — stored on the
 * subscription (`product_subscription.billing_anchor_day`), not re-derived from
 * the previous charge. Clamping applies to the short month only: 31 January ->
 * 28 February -> 31 March, never 28 February -> 28 March.
 */
export function nextChargeOn(period: IsraelDate, anchorDay: number): IsraelDate {
  return addIsraelMonthsAnchored(period, 1, anchorDay);
}

/**
 * The anchor day to store for a subscription that predates the anchor column.
 *
 * Existing rows have already drifted; this reads the day back off whichever
 * date is the best evidence of the original intent. `charging_starts_at` is the
 * day the schedule was set up and has never been advanced by the buggy
 * arithmetic, so it is preferred over `next_charge_on`, which may already carry
 * a clamped 28. The same precedence is implemented in migration 0045's backfill.
 */
export function inferAnchorDay(
  chargingStartsAt: string | null,
  nextChargeOnDate: string | null,
): number {
  const source = chargingStartsAt ?? nextChargeOnDate;
  if (source === null) return 1;
  return anchorDayOf(israelDate(source.slice(0, 10)));
}

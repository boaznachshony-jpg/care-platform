import type { BillingAccessState } from '@caredesk/schemas';

/**
 * The minimal slice of the product subscription needed to decide whether the
 * tenant may use the app. Everything here already exists on
 * ProductSubscriptionPlan — the derivation is pure and stores nothing new.
 */
export interface BillingAccessInput {
  launchDiscountPercent: number;
  /** ISO date (YYYY-MM-DD) on which paid charging begins; null = no policy. */
  chargingStartsAt: string | null;
  paymentMethod: unknown | null;
}

export interface BillingAccessDerivation {
  accessState: BillingAccessState;
  /** Whole days left in the grace window; null unless accessState is 'grace'. */
  graceDaysRemaining: number | null;
}

const MS_PER_DAY = 86_400_000;

const ACTIVE: BillingAccessDerivation = { accessState: 'active', graceDaysRemaining: null };

/**
 * Derives the tenant's app-access state from the billing plan.
 *
 * 'active' when any of these hold:
 *   - a payment method is on file (payment is arranged);
 *   - launchDiscountPercent === 100 (fully sponsored — nothing to collect);
 *   - chargingStartsAt is null (no charge-date policy applies to this tenant:
 *     paid billing is activated explicitly per tenant, see container defaults);
 *   - chargingStartsAt is still in the future (payment not yet required).
 *
 * Otherwise payment is required but missing. The grace window is anchored on
 * chargingStartsAt: the subscription record has no creation timestamp, and
 * chargingStartsAt is set exactly when sponsorship ends and paid billing is
 * switched on for the tenant — i.e. the first moment a payment method becomes
 * necessary. Within `graceDays` calendar days of that anchor the state is
 * 'grace'; from day `graceDays` onward it is 'frozen'.
 */
export function deriveBillingAccessState(
  plan: BillingAccessInput,
  graceDays: number,
  now: Date,
): BillingAccessDerivation {
  if (plan.paymentMethod) return ACTIVE;
  if (plan.launchDiscountPercent === 100) return ACTIVE;
  if (!plan.chargingStartsAt) return ACTIVE;

  // 'YYYY-MM-DD' parses as UTC midnight; full ISO timestamps also work. An
  // unparseable value fails open ('active') — a data glitch must never lock
  // a paying customer out of the product.
  const anchorMs = Date.parse(plan.chargingStartsAt);
  if (Number.isNaN(anchorMs)) return ACTIVE;
  if (now.getTime() < anchorMs) return ACTIVE;

  const elapsedDays = Math.floor((now.getTime() - anchorMs) / MS_PER_DAY);
  if (elapsedDays < graceDays) {
    return { accessState: 'grace', graceDaysRemaining: graceDays - elapsedDays };
  }
  return { accessState: 'frozen', graceDaysRemaining: null };
}

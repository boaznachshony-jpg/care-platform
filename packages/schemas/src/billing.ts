import { z } from 'zod';
import { PRODUCT_BILLING_TERMS_VERSION, type ProductSubscriptionStatus } from '@caredesk/domain';

export const BILLING_TERMS_VERSION = PRODUCT_BILLING_TERMS_VERSION;

export const startBillingSetupRequestSchema = z.object({
  billingName: z.string().trim().min(2).max(120),
  billingEmail: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  acceptsRecurringCharge: z.literal(true),
  termsVersion: z.literal(BILLING_TERMS_VERSION),
});

export type StartBillingSetupRequest = z.infer<typeof startBillingSetupRequestSchema>;

/**
 * Derived (never stored) app-access state for the tenant:
 * - 'active'  — a payment method exists, the plan is fully sponsored, or no
 *               charge-date policy applies yet, so the app is fully usable.
 * - 'grace'   — payment is required but missing; the tenant is inside the
 *               grace window and only sees a warning.
 * - 'frozen'  — payment is required, missing, and the grace window has
 *               elapsed; the app is locked until payment is arranged.
 */
export const BILLING_ACCESS_STATES = ['active', 'grace', 'frozen'] as const;
export type BillingAccessState = (typeof BILLING_ACCESS_STATES)[number];

export interface BillingPlanResponse {
  status: ProductSubscriptionStatus;
  currency: 'ILS';
  interval: 'month';
  priceAgorot: number;
  netAgorot: number;
  vatAgorot: number;
  vatRatePercent: number;
  includesVat: true;
  launchDiscountPercent: number;
  effectivePriceAgorot: number;
  chargingStartsAt: string | null;
  nextChargeOn: string | null;
  billingName: string | null;
  billingEmail: string | null;
  paymentMethod: {
    last4: string;
    expiryMonth: number;
    expiryYear: number;
  } | null;
  canManage: boolean;
  providerConfigured: boolean;
  termsVersion: string;
  accessState: BillingAccessState;
  /** Whole days left in the grace window; null unless accessState is 'grace'. */
  graceDaysRemaining: number | null;
}

export interface BillingCheckoutResponse {
  checkoutUrl: string;
}

export const cardcomWebhookSchema = z.object({
  LowProfileId: z.string().uuid().optional(),
  lowprofilecode: z.string().uuid().optional(),
  lowProfileId: z.string().uuid().optional(),
});

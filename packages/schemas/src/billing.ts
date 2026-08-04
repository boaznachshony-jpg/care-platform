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
}

export interface BillingCheckoutResponse {
  checkoutUrl: string;
}

export const cardcomWebhookSchema = z.object({
  LowProfileId: z.string().uuid().optional(),
  lowprofilecode: z.string().uuid().optional(),
  lowProfileId: z.string().uuid().optional(),
});

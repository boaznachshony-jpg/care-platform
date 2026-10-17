import { z } from 'zod';
import { isoDateSchema } from './date.js';

const identity = z.string().trim().min(1).max(160);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const signedMoney = z
  .number()
  .finite()
  .min(-10_000_000)
  .max(10_000_000)
  .refine((amount) => {
    const decimal = String(amount);
    return !/[eE]/.test(decimal) && (decimal.split('.')[1]?.length ?? 0) <= 2;
  }, 'Whole agorot required');
const money = signedMoney.refine((amount) => amount >= 0, 'Non-negative amount required');
const dayKind = z.enum([
  'rest_worked',
  'holiday_worked',
  'holiday_unworked',
  'vacation_paid',
  'vacation_redemption',
  'sick',
  'unpaid_absence',
]);
const deductionCategory = z.enum(['medical', 'housing', 'agreed', 'other']);

export const PayrollCalculationContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    restDay: z.union([z.literal(0), z.literal(5), z.literal(6)]).optional(),
    salaryPeriods: z
      .array(
        z
          .object({
            from: isoDateSchema,
            to: isoDateSchema,
            monthlySalary: money,
            ruleId: identity,
          })
          .strict(),
      )
      .min(1)
      .max(31)
      .optional(),
    dayFacts: z
      .array(
        z
          .object({
            id: identity,
            date: isoDateSchema,
            kind: dayKind,
            quantity: z
              .number()
              .finite()
              .positive()
              .max(1)
              .refine(
                (quantity) =>
                  !/[eE]/.test(String(quantity)) &&
                  (String(quantity).split('.')[1]?.length ?? 0) <= 2,
                'At most two decimal day digits required',
              ),
            ruleId: identity,
            episodeId: identity.optional(),
            episodeStart: isoDateSchema.optional(),
          })
          .strict(),
      )
      .max(200)
      .optional(),
    deductionItems: z
      .array(
        z
          .object({
            id: identity,
            category: deductionCategory,
            amount: money,
            actualCost: money,
            consent: z.boolean(),
            ruleId: identity,
          })
          .strict(),
      )
      .max(100)
      .optional(),
    paymentEvents: z
      .array(
        z
          .object({
            id: identity,
            date: isoDateSchema,
            appliesToMonth: month,
            kind: z.enum(['advance', 'pocket_money']),
            amount: money,
          })
          .strict(),
      )
      .max(200)
      .optional(),
    openingBalance: z
      .object({
        sourceMonth: month,
        amount: signedMoney,
        reference: identity,
        sourceVersion: z.number().int().positive(),
        ruleId: identity,
      })
      .strict()
      .optional(),
  })
  .strict();

export const PayrollRuleConfigurationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('proration'),
      convention: z.literal('exclude_rest_days_from_both_terms'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('day'),
      purpose: dayKind,
      treatment: z.enum(['included_in_base', 'addition', 'base_reduction']),
      dailyRate: money,
      overlap: z.enum(['exclusive', 'stack']),
      priority: z.number().int().min(0).max(1000),
      episodeRates: z
        .array(
          z
            .object({
              throughDay: z.number().int().positive().nullable(),
              multiplier: z.number().finite().min(0).max(10),
            })
            .strict(),
        )
        .min(1)
        .max(100)
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('deduction'),
      category: deductionCategory,
      maximum: money,
      actualCostFraction: z.number().finite().min(0).max(1),
      consentRequired: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal('carry'), allowSignedCarry: z.boolean() }).strict(),
]);

/** Only the server resolver may turn a stored reviewed rule into this contract. */
export const VerifiedPayrollRuleSchema = z
  .object({
    id: identity,
    code: identity,
    version: z.number().int().positive(),
    status: z.literal('active'),
    effectiveFrom: isoDateSchema,
    effectiveTo: isoDateSchema.nullable().optional(),
    sourceReference: z.string().trim().min(1).max(2000),
    sourceVerifiedAt: z.string().datetime({ offset: true }),
    reviewedBy: identity,
    approvedAt: z.string().datetime({ offset: true }),
    config: PayrollRuleConfigurationSchema,
  })
  .strict()
  .refine(
    (rule) => rule.effectiveTo == null || rule.effectiveTo >= rule.effectiveFrom,
    'Rule effective range is reversed',
  )
  .refine(
    (rule) => Date.parse(rule.approvedAt) >= Date.parse(rule.sourceVerifiedAt),
    'Rule approval must follow source verification',
  );

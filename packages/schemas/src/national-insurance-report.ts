import { z } from 'zod';
import { isoDateSchema } from './date.js';

/**
 * R5-09 - the National Insurance report as filed: one line per wage month, the
 * shape of the Institute's own form. Stage 1 of
 * docs/governance/R5-09-NATIONAL-INSURANCE-REPORT-TABLE.md.
 *
 * The line mirrors `MvpNationalInsuranceReportMonth` in
 * apps/web/src/storage/mvp-storage.ts field for field, because stage 2 copies
 * those saved lines here unchanged. Every bound below is one the payroll
 * screen already respects, so a line it saved is a line this accepts.
 */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_AMOUNT = 10_000_000;

/** At most two decimals: `rate_percent` is numeric(5,2), and rounding a rate would change the amount. */
const hasAtMostTwoDecimals = (value: number) =>
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-9;

const reportMonthSchema = z
  .object({
    month: z.string().regex(MONTH, 'Month (YYYY-MM) required'),
    employed: z.boolean(),
    /** Whole shekels: the Institute's form is "ללא אגורות". */
    wage: z.number().int().min(0).max(MAX_AMOUNT),
    ratePercent: z
      .number()
      .finite()
      .min(0)
      .max(100)
      .refine(hasAtMostTwoDecimals, 'At most two decimals'),
    /** wage x rate, to the agora. The server recomputes it and refuses a mismatch. */
    amount: z.number().finite().min(0).max(MAX_AMOUNT),
  })
  .strict()
  .refine((line) => line.employed || (line.wage === 0 && line.amount === 0), {
    message: 'A month without employment carries no wage and no amount',
    path: ['employed'],
  });
export type NationalInsuranceReportMonth = z.infer<typeof reportMonthSchema>;

/**
 * Stage 2's copy of one saved payment's report lines. Idempotent on
 * `legacyExpenseId`: the same payment sent twice returns the same report.
 * An annual payment carries twelve lines; 24 leaves room without inviting
 * unbounded bodies.
 */
export const importNationalInsuranceReportRequestSchema = z
  .object({
    legacyExpenseId: z.string().trim().min(1).max(200),
    dueDate: isoDateSchema,
    months: z
      .array(reportMonthSchema)
      .min(1)
      .max(24)
      .refine(
        (months) => new Set(months.map((line) => line.month)).size === months.length,
        'Each month may appear once',
      ),
  })
  .strict();
export type ImportNationalInsuranceReportRequest = z.infer<
  typeof importNationalInsuranceReportRequestSchema
>;

export interface NationalInsuranceReportResponse {
  id: string;
  legacyExpenseId: string | null;
  /** First and last wage month covered, YYYY-MM. */
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  version: number;
  months: NationalInsuranceReportMonth[];
  createdAt: string;
  updatedAt: string;
}

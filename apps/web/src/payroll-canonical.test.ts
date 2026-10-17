import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateMonthlyPayroll } from '@caredesk/domain';
import type { PayrollEntryResponse } from './api/client.js';
import type { MvpPayrollRecord } from './storage/mvp-storage.js';
import {
  canonicalPayrollCloseCost,
  canonicalPayrollEmploymentCost,
  canonicalPayrollReportRecord,
  canonicalWizardRequest,
  finalPayrollForClose,
  legacyPayrollEntryRequest,
  mergePayrollReportSources,
} from './payroll-canonical.js';
import { createAnnualPayrollReport, payrollRecordDeductions } from './payroll-report.js';
import {
  nationalInsuranceMonthRows,
  nationalInsuranceReportMonths,
  overridesFromReportMonths,
} from './pages/PayrollPage.js';
import { payrollEntryRequest } from './api/strict-bodies.js';
import type { CanonicalPayrollClose } from './api/client.js';

const api = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn() }));
vi.mock('./api/client.js', () => ({
  listPayrollEntries: (...args: unknown[]) => api.list(...args),
  savePayrollEntry: (...args: unknown[]) => api.save(...args),
}));

function entry(overrides: Partial<PayrollEntryResponse> = {}): PayrollEntryResponse {
  const input = {
    id: 'f3e7d48d-7115-4198-96fd-dbc62646a3d8',
    month: '2026-09',
    baseSalary: 6000,
    workDays: 26,
    paidRestDays: 2,
    restDayRate: 440.55,
    paidHolidays: 0,
    holidayPay: 0,
    vacationDays: 0,
    vacationPay: 0,
    sickDays: 0,
    sickPay: 0,
    otherAbsenceDays: 0,
    employerContributions: 1000,
    additionalPayments: [],
    pocketMoney: 400,
    deductions: 150,
    advances: 700,
    agreedDeductions: 100,
    status: 'draft' as const,
    version: 3,
    createdAt: '2026-09-30T08:00:00Z',
    updatedAt: '2026-09-30T09:00:00Z',
    ...overrides,
  };
  return { ...input, total: calculateMonthlyPayroll(input).total };
}
function legacy(source = entry()): MvpPayrollRecord {
  const {
    canonicalEntry: _entry,
    canonicalDeductions: _deductions,
    ...record
  } = canonicalPayrollReportRecord(source);
  return { ...record, medicalInsuranceDeduction: source.deductions };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue([]);
});

describe('canonical payment reports and explicit close', () => {
  it('uses one canonical record per month and falls back only for unmatched legacy months', () => {
    const canonical = entry();
    const result = mergePayrollReportSources(
      [legacy(entry({ baseSalary: 1000 })), { ...legacy(), id: 'old-year', month: '2025-12' }],
      [canonical, { ...canonical, version: 2, baseSalary: 2000 }],
    );
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.month === '2026-09')?.baseSalary).toBe(6000);
    expect(createAnnualPayrollReport(result, '2026').monthsReported).toBe(1);
    expect(createAnnualPayrollReport(result, '2025').monthsReported).toBe(1);
  });

  it('keeps report and NI wages after the legacy record is purged without dual-writing it', () => {
    const canonical = entry();
    const before = mergePayrollReportSources([legacy()], [canonical]);
    const after = mergePayrollReportSources([], [canonical]);
    expect(createAnnualPayrollReport(after, '2026')).toEqual(
      createAnnualPayrollReport(before, '2026'),
    );
    const rows = nationalInsuranceMonthRows(after, ['2026-09'], 1000, '3.6', {}, '2026-10');
    expect(rows[0]).toMatchObject({ wage: 6881, wageSource: 'payroll-records', amount: 247.72 });
  });

  it('does not relabel canonical aggregate deductions as medical or housing', () => {
    const record = canonicalPayrollReportRecord(entry());
    expect(record.medicalInsuranceDeduction).toBe(0);
    expect(record.housingDeduction).toBe(0);
    expect(payrollRecordDeductions(record)).toBe(1350);
    const report = createAnnualPayrollReport([record], '2026');
    expect(report.totalPaid).toBe(6531.1);
    expect(report.payableToWorker).toBe(5531.1);
    expect(report.previouslyPaid).toBe(1100);
    expect(report.employmentCost).toBe(7631.1);
  });

  it('preserves submitted NI month values when source wages and contract change', () => {
    const submitted = nationalInsuranceReportMonths(
      nationalInsuranceMonthRows([legacy()], ['2026-09'], 0, '3.6', {}, '2026-10'),
    );
    const bytes = JSON.stringify(submitted);
    const updated = mergePayrollReportSources([], [entry({ baseSalary: 9000 })]);
    const reopened = nationalInsuranceMonthRows(
      updated,
      ['2026-09'],
      15000,
      '5',
      overridesFromReportMonths(submitted),
      '2026-10',
    );
    expect(nationalInsuranceReportMonths(reopened)).toEqual(submitted);
    expect(JSON.stringify(submitted)).toBe(bytes);
  });

  it('finalizes a saved canonical draft with its version and preserves context before closing', async () => {
    const original = entry({ deductions: 0, calculationContext: { schemaVersion: 1, restDay: 6 } });
    api.list.mockResolvedValue([original]);
    api.save.mockResolvedValue({ entry: { ...original, status: 'final', version: 4 } });
    const final = await finalPayrollForClose('case-1', canonicalPayrollReportRecord(original));
    expect(api.save).toHaveBeenCalledWith(
      'case-1',
      '2026-09',
      expect.objectContaining({
        status: 'final',
        version: 3,
        calculationContext: original.calculationContext,
      }),
      expect.any(String),
    );
    expect(final).toMatchObject({ status: 'final', version: 4 });
    expect(payrollEntryRequest(final)).toHaveProperty(
      'calculationContext',
      original.calculationContext,
    );
  });

  it('refuses stale canonical versions and mismatching legacy copies without overwriting either', async () => {
    const original = entry();
    api.list.mockResolvedValue([{ ...original, version: 4 }]);
    await expect(
      finalPayrollForClose('case-1', canonicalPayrollReportRecord(original)),
    ).rejects.toThrow('PAYROLL_VERSION_CONFLICT');
    api.list.mockResolvedValue([entry({ baseSalary: 6500 })]);
    await expect(finalPayrollForClose('case-1', legacy(original))).rejects.toThrow(
      'PAYROLL_MISMATCH',
    );
    expect(api.save).not.toHaveBeenCalled();
  });

  it('creates a final canonical entry only for the explicit close when none exists', async () => {
    const source = legacy(entry({ status: 'final' }));
    api.save.mockResolvedValue({ entry: entry({ status: 'final', version: 1 }) });
    await finalPayrollForClose('case-1', source);
    expect(api.save).toHaveBeenCalledWith(
      'case-1',
      source.month,
      expect.objectContaining({ status: 'final', total: source.total, deductions: 150 }),
      expect.any(String),
    );
  });

  it('rejects raw half-agora input but accepts ordinary decimal deduction sums', () => {
    expect(() =>
      legacyPayrollEntryRequest({ ...legacy(), medicalInsuranceDeduction: 0.005 }),
    ).toThrow();
    const source = legacy(entry({ deductions: 0.3 }));
    source.medicalInsuranceDeduction = 0.1;
    source.housingDeduction = 0.2;
    expect(legacyPayrollEntryRequest(source).deductions).toBe(0.3);
  });

  it('preserves untouched itemized deductions and context, refusing invisible factual rewrites', () => {
    const original = entry({
      calculationContext: {
        schemaVersion: 1,
        deductionItems: [
          {
            id: 'medical',
            category: 'medical',
            amount: 100,
            actualCost: 200,
            consent: true,
            ruleId: 'verified-medical',
          },
          {
            id: 'housing',
            category: 'housing',
            amount: 50,
            actualCost: 100,
            consent: true,
            ruleId: 'verified-housing',
          },
        ],
      },
    });
    const record = canonicalPayrollReportRecord(original);
    expect(record).toMatchObject({ medicalInsuranceDeduction: 100, housingDeduction: 50 });
    const request = canonicalWizardRequest(record, original);
    expect(request).toMatchObject({
      deductions: 150,
      calculationContext: original.calculationContext,
      version: 3,
    });
    expect(() =>
      canonicalWizardRequest(
        { ...record, medicalInsuranceDeduction: 90, total: record.total + 10 },
        original,
      ),
    ).toThrow('PAYROLL_CONTEXT_CONFLICT');
  });

  it('does not confuse new worker receipts or signed carry with employer cost', () => {
    const source = entry({
      paidRestDays: 0,
      restDayRate: 0,
      pocketMoney: 0,
      deductions: 0,
      agreedDeductions: 0,
      advances: 6500,
    });
    expect(source.total).toBe(500);
    expect(canonicalPayrollEmploymentCost(source)).toBe(7000);
    const receipt = {
      payrollReference: source.id,
      month: source.month,
      total: -700,
      calculationTotal: 500,
      employerContributions: 1000,
      openingBalance: -200,
      settlementBasis: 'worker',
    } as CanonicalPayrollClose;
    expect(canonicalPayrollCloseCost(receipt, [source])).toBe(7000);
    const report = createAnnualPayrollReport(
      [
        canonicalPayrollReportRecord({
          ...source,
          calculationContext: {
            schemaVersion: 1,
            openingBalance: {
              sourceMonth: '2026-08',
              amount: -200,
              reference: 'prior',
              sourceVersion: 1,
              ruleId: 'carry',
            },
          },
        }),
      ],
      '2026',
    );
    expect(report).toMatchObject({
      totalPaid: 500,
      payableToWorker: -500,
      previouslyPaid: 6500,
      employmentCost: 7000,
    });
    expect(
      canonicalPayrollCloseCost({ ...receipt, settlementBasis: 'legacy_total', total: 500 }, [
        source,
      ]),
    ).toBe(500);
    expect(canonicalPayrollCloseCost(receipt, [])).toBeNull();
  });

  it('retains historical totals while separating prior payment, worker settlement and cost', () => {
    const source = entry({
      paidRestDays: 0,
      restDayRate: 0,
      pocketMoney: 0,
      deductions: 0,
      agreedDeductions: 0,
      advances: 1000,
    });
    const record = canonicalPayrollReportRecord(source);
    const report = createAnnualPayrollReport([record], '2026');
    expect(record.total).toBe(6000);
    expect(report).toMatchObject({
      totalPaid: 6000,
      payableToWorker: 5000,
      previouslyPaid: 1000,
      employmentCost: 7000,
      deductions: 1000,
      costDeductions: 0,
    });
  });
});

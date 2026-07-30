import { describe, expect, it } from 'vitest';
import { calculateMonthlyPayroll, calculateProratedBaseSalary } from './payroll-calculation.js';

const emptyInput = {
  baseSalary: 7_000,
  paidSaturdays: 0,
  saturdayRate: 0,
  holidayPay: 0,
  vacationPay: 0,
  sickPay: 0,
  pocketMoney: 0,
  employerContributions: 0,
  otherAddition: 0,
  medicalInsuranceDeduction: 0,
  housingDeduction: 0,
  advances: 0,
  agreedDeduction: 0,
};

describe('monthly payroll calculation', () => {
  it('prorates the base salary from the selected date through the end of the month', () => {
    expect(calculateProratedBaseSalary(6_400, '2026-07', '2026-07-16')).toEqual({
      amount: 3_318.52,
      paidDays: 14,
      daysInMonth: 27,
      calendarDaysInMonth: 31,
      excludedSaturdays: 4,
      isProrated: true,
    });
  });

  it('keeps the full base salary when no partial-month date is selected', () => {
    expect(calculateProratedBaseSalary(6_400, '2026-07', '')).toEqual({
      amount: 6_400,
      paidDays: 27,
      daysInMonth: 27,
      calendarDaysInMonth: 31,
      excludedSaturdays: 4,
      isProrated: false,
    });
  });

  it('calculates flexible Saturday pay from count and rate', () => {
    expect(
      calculateMonthlyPayroll({
        ...emptyInput,
        paidSaturdays: 3,
        saturdayRate: 450,
      }),
    ).toEqual({
      saturdayPay: 1_350,
      additions: 1_350,
      deductions: 0,
      total: 8_350,
    });
  });

  it('adds optional additions and subtracts advances and deductions', () => {
    expect(
      calculateMonthlyPayroll({
        ...emptyInput,
        paidSaturdays: 2,
        saturdayRate: 500,
        holidayPay: 300,
        otherAddition: 250,
        advances: 700,
        agreedDeduction: 100,
      }),
    ).toMatchObject({
      saturdayPay: 1_000,
      additions: 1_550,
      deductions: 800,
      total: 7_750,
    });
  });

  it('treats pocket money already paid during the month as a deduction', () => {
    expect(
      calculateMonthlyPayroll({
        ...emptyInput,
        paidSaturdays: 2,
        saturdayRate: 439.98,
        pocketMoney: 100,
      }),
    ).toMatchObject({
      saturdayPay: 879.96,
      additions: 879.96,
      deductions: 100,
      total: 7_779.96,
    });
  });

  it('never returns a negative payment', () => {
    expect(
      calculateMonthlyPayroll({
        ...emptyInput,
        baseSalary: 100,
        advances: 500,
      }).total,
    ).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { calculateMonthlyPayroll } from './payroll-calculation.js';

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

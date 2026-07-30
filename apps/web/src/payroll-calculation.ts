export interface MonthlyPayrollInput {
  baseSalary: number;
  paidSaturdays: number;
  saturdayRate: number;
  holidayPay: number;
  vacationPay: number;
  sickPay: number;
  pocketMoney: number;
  employerContributions: number;
  otherAddition: number;
  medicalInsuranceDeduction: number;
  housingDeduction: number;
  advances: number;
  agreedDeduction: number;
}

export interface MonthlyPayrollCalculation {
  saturdayPay: number;
  additions: number;
  deductions: number;
  total: number;
}

function safeAmount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function calculateMonthlyPayroll(input: MonthlyPayrollInput): MonthlyPayrollCalculation {
  const saturdayPay = safeAmount(input.paidSaturdays) * safeAmount(input.saturdayRate);
  const additions =
    saturdayPay +
    safeAmount(input.holidayPay) +
    safeAmount(input.vacationPay) +
    safeAmount(input.sickPay) +
    safeAmount(input.employerContributions) +
    safeAmount(input.otherAddition);
  const deductions =
    safeAmount(input.pocketMoney) +
    safeAmount(input.medicalInsuranceDeduction) +
    safeAmount(input.housingDeduction) +
    safeAmount(input.advances) +
    safeAmount(input.agreedDeduction);

  return {
    saturdayPay,
    additions,
    deductions,
    total: Math.max(0, safeAmount(input.baseSalary) + additions - deductions),
  };
}

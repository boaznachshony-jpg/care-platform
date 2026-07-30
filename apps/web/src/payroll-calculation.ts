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

export interface ProratedBaseSalary {
  amount: number;
  paidDays: number;
  daysInMonth: number;
  isProrated: boolean;
}

function safeAmount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function calculateProratedBaseSalary(
  baseSalary: number,
  month: string,
  startDate: string,
): ProratedBaseSalary {
  const fullSalary = safeAmount(baseSalary);
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(month);
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);

  if (!monthMatch) {
    return { amount: fullSalary, paidDays: 0, daysInMonth: 0, isProrated: false };
  }

  const year = Number(monthMatch[1]);
  const monthNumber = Number(monthMatch[2]);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  if (
    !dateMatch ||
    Number(dateMatch[1]) !== year ||
    Number(dateMatch[2]) !== monthNumber ||
    Number(dateMatch[3]) < 1 ||
    Number(dateMatch[3]) > daysInMonth
  ) {
    return {
      amount: fullSalary,
      paidDays: daysInMonth,
      daysInMonth,
      isProrated: false,
    };
  }

  const startDay = Number(dateMatch[3]);
  const paidDays = daysInMonth - startDay + 1;
  return {
    amount: Math.round(((fullSalary * paidDays) / daysInMonth) * 100) / 100,
    paidDays,
    daysInMonth,
    isProrated: startDay > 1,
  };
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

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
  calendarDaysInMonth: number;
  excludedSaturdays: number;
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
    return {
      amount: fullSalary,
      paidDays: 0,
      daysInMonth: 0,
      calendarDaysInMonth: 0,
      excludedSaturdays: 0,
      isProrated: false,
    };
  }

  const year = Number(monthMatch[1]);
  const monthNumber = Number(monthMatch[2]);
  const calendarDaysInMonth = new Date(year, monthNumber, 0).getDate();
  const countBaseDays = (firstDay: number, lastDay: number) => {
    let count = 0;
    for (let day = firstDay; day <= lastDay; day += 1) {
      if (new Date(year, monthNumber - 1, day).getDay() !== 6) count += 1;
    }
    return count;
  };
  const daysInMonth = countBaseDays(1, calendarDaysInMonth);
  const excludedSaturdays = calendarDaysInMonth - daysInMonth;
  if (
    !dateMatch ||
    Number(dateMatch[1]) !== year ||
    Number(dateMatch[2]) !== monthNumber ||
    Number(dateMatch[3]) < 1 ||
    Number(dateMatch[3]) > calendarDaysInMonth
  ) {
    return {
      amount: fullSalary,
      paidDays: daysInMonth,
      daysInMonth,
      calendarDaysInMonth,
      excludedSaturdays,
      isProrated: false,
    };
  }

  const startDay = Number(dateMatch[3]);
  const paidDays = countBaseDays(startDay, calendarDaysInMonth);
  return {
    amount: Math.round(((fullSalary * paidDays) / daysInMonth) * 100) / 100,
    paidDays,
    daysInMonth,
    calendarDaysInMonth,
    excludedSaturdays,
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

/* eslint-disable no-restricted-syntax */
export type QuarterlyInsuranceStatus = 'not_open' | 'open' | 'attention' | 'due_today' | 'overdue';

export interface QuarterlyInsuranceTask {
  id: string;
  quarter: 1 | 2 | 3 | 4;
  year: number;
  title: string;
  periodLabel: string;
  periodRange: string;
  paymentWindow: string;
  deadlineLabel: string;
  periodStart: string;
  periodEnd: string;
  paymentOpenDate: string;
  deadlineDate: string;
  preparationOnly: boolean;
  status: QuarterlyInsuranceStatus;
  statusLabel: string;
}

export interface QuarterlyInsuranceSchedule {
  id: string;
  quarter: 1 | 2 | 3 | 4;
  year: number;
  periodLabel: string;
  periodRange: string;
  paymentWindow: string;
  deadlineLabel: string;
  periodStart: string;
  periodEnd: string;
  paymentOpenDate: string;
  deadlineDate: string;
}

const quarterMonths = [
  ['ינואר', 'מרץ'],
  ['אפריל', 'יוני'],
  ['יולי', 'ספטמבר'],
  ['אוקטובר', 'דצמבר'],
] as const;

const deadlineMonths = [
  'בינואר',
  'בפברואר',
  'במרץ',
  'באפריל',
  'במאי',
  'ביוני',
  'ביולי',
  'באוגוסט',
  'בספטמבר',
  'באוקטובר',
  'בנובמבר',
  'בדצמבר',
] as const;

function isoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dayMonth(year: number, monthIndex: number, day: number): string {
  void year;
  return `${day}.${monthIndex + 1}`;
}

function localIso(date: Date): string {
  return isoDate(date.getFullYear(), date.getMonth(), date.getDate());
}

function relevantQuarter(today: Date): { year: number; quarter: 1 | 2 | 3 | 4 } {
  const month = today.getMonth();
  if (month % 3 === 0) {
    const previousMonth = month === 0 ? 11 : month - 1;
    const year = month === 0 ? today.getFullYear() - 1 : today.getFullYear();
    return { year, quarter: (Math.floor(previousMonth / 3) + 1) as 1 | 2 | 3 | 4 };
  }
  return {
    year: today.getFullYear(),
    quarter: (Math.floor(month / 3) + 1) as 1 | 2 | 3 | 4,
  };
}

function createQuarterlyInsuranceSchedule(
  year: number,
  quarter: 1 | 2 | 3 | 4,
): QuarterlyInsuranceSchedule {
  const startMonth = (quarter - 1) * 3;
  const endMonth = startMonth + 2;
  const endDay = new Date(year, endMonth + 1, 0).getDate();
  const paymentMonth = (endMonth + 1) % 12;
  const paymentYear = endMonth === 11 ? year + 1 : year;
  const [startMonthLabel, endMonthLabel] = quarterMonths[quarter - 1]!;
  const periodLabel = `${startMonthLabel}–${endMonthLabel}`;

  return {
    id: `national-insurance-${year}-q${quarter}`,
    quarter,
    year,
    periodLabel,
    periodRange: `תקופת דיווח: ${dayMonth(year, startMonth, 1)}–${dayMonth(year, endMonth, endDay)}`,
    paymentWindow: `ניתן לשלם בין ${dayMonth(paymentYear, paymentMonth, 1)} ל־${dayMonth(paymentYear, paymentMonth, 15)}`,
    deadlineLabel: `מועד אחרון: 15 ${deadlineMonths[paymentMonth]}`,
    periodStart: isoDate(year, startMonth, 1),
    periodEnd: isoDate(year, endMonth, endDay),
    paymentOpenDate: isoDate(paymentYear, paymentMonth, 1),
    deadlineDate: isoDate(paymentYear, paymentMonth, 15),
  };
}

export function quarterlyInsuranceScheduleForPayrollMonth(
  payrollMonth: string,
): QuarterlyInsuranceSchedule | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(payrollMonth);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const quarter = (Math.floor(monthIndex / 3) + 1) as 1 | 2 | 3 | 4;
  return createQuarterlyInsuranceSchedule(year, quarter);
}

export function createQuarterlyInsuranceTask(today = new Date()): QuarterlyInsuranceTask {
  const { year, quarter } = relevantQuarter(today);
  const schedule = createQuarterlyInsuranceSchedule(year, quarter);
  const currentDate = localIso(today);
  const preparationOnly = currentDate === schedule.periodEnd;

  let status: QuarterlyInsuranceStatus;
  let statusLabel: string;
  if (currentDate < schedule.paymentOpenDate) {
    status = 'not_open';
    statusLabel = 'טרם נפתח לתשלום';
  } else if (currentDate <= schedule.deadlineDate.replace(/15$/, '09')) {
    status = 'open';
    statusLabel = 'פתוח לתשלום';
  } else if (currentDate <= schedule.deadlineDate.replace(/15$/, '14')) {
    status = 'attention';
    statusLabel = 'דורש טיפול';
  } else if (currentDate === schedule.deadlineDate) {
    status = 'due_today';
    statusLabel = 'מועד אחרון היום';
  } else {
    status = 'overdue';
    statusLabel = 'באיחור';
  }

  return {
    ...schedule,
    quarter,
    year,
    title: preparationOnly
      ? 'הכנת נתוני ביטוח לאומי לרבעון'
      : `תשלום ביטוח לאומי לרבעון ${schedule.periodLabel}`,
    preparationOnly,
    status,
    statusLabel,
  };
}

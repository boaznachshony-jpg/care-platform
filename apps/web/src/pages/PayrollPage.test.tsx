import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import {
  emptyMvpProfile,
  readMvpEmploymentExpenses,
  readMvpPayroll,
  saveMvpPayroll,
  saveMvpProfile,
  type MvpPayrollRecord,
} from '../storage/mvp-storage.js';
import {
  DEFAULT_NATIONAL_INSURANCE_RATE_PERCENT,
  monthsInRange,
  hebrewMonthLabel,
  nationalInsuranceAmount,
  nationalInsuranceMonthRows,
  nationalInsuranceTotals,
  nationalInsuranceWageMonths,
  nextSequencePayrollValues,
  PayrollPage,
  recordedGrossWage,
} from './PayrollPage.js';

describe('PayrollPage retroactive sequence helpers', () => {
  it('creates an inclusive month range across a year boundary', () => {
    expect(monthsInRange('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(monthsInRange('2026-03', '2026-01')).toEqual([]);
  });

  it('copies only fixed payroll values into the next month', () => {
    expect(nextSequencePayrollValues('2026-04', '7000', '450')).toMatchObject({
      month: '2026-04',
      baseSalary: '7000',
      saturdayRate: '450',
      workDays: '0',
      paidSaturdays: '0',
      holidayPay: '0',
      pocketMoney: '0',
      otherAddition: '0',
      advances: '0',
      agreedDeduction: '0',
    });
  });
});

describe('PayrollPage annual report', () => {
  beforeEach(() => {
    localStorage.clear();
    saveMvpProfile({
      ...emptyMvpProfile,
      baseSalary: 7_000,
      salaryEffectiveDate: '2025-01-01',
    });
    saveMvpPayroll([
      {
        id: 'pay-2026-01',
        month: '2026-01',
        baseSalary: 7_000,
        workDays: 26,
        paidSaturdays: 1,
        saturdayPay: 500,
        pocketMoney: 0,
        otherAddition: 0,
        advances: 100,
        agreedDeduction: 0,
        total: 7_400,
        savedAt: '2026-01-31T12:00:00.000Z',
      },
      {
        id: 'pay-2026-02',
        month: '2026-02',
        baseSalary: 7_000,
        workDays: 24,
        paidSaturdays: 0,
        saturdayPay: 0,
        pocketMoney: 0,
        otherAddition: 250,
        advances: 0,
        agreedDeduction: 0,
        total: 7_250,
        savedAt: '2026-02-28T12:00:00.000Z',
      },
      {
        id: 'pay-2025-12',
        month: '2025-12',
        baseSalary: 6_500,
        workDays: 26,
        paidSaturdays: 0,
        saturdayPay: 0,
        pocketMoney: 0,
        otherAddition: 0,
        advances: 0,
        agreedDeduction: 0,
        total: 6_500,
        savedAt: '2025-12-31T12:00:00.000Z',
      },
    ]);
  });

  it('starts a retroactive sequence at the first missing month and skips existing months', () => {
    render(<PayrollPage />);

    fireEvent.change(screen.getByLabelText('חודש התחלה לרצף'), { target: { value: '2026-01' } });
    fireEvent.change(screen.getByLabelText('חודש סיום לרצף'), { target: { value: '2026-03' } });
    fireEvent.click(screen.getByRole('button', { name: 'התחלת הזנת רצף' }));

    expect(screen.getByText('חודש 1 מתוך 1')).toBeInTheDocument();
    expect(screen.getByText('כעת מזינים: 2026-03')).toBeInTheDocument();
    expect(screen.getByText('2 חודשים קיימים ידולגו.')).toBeInTheDocument();
    const payrollMonthInput = document.querySelector('.wizard-content input[type="month"]');
    expect(payrollMonthInput).toHaveValue('2026-03');
    expect(payrollMonthInput).toBeDisabled();
  });

  it('shows a reconciled report and changes the monthly detail with the selected year', () => {
    render(<PayrollPage />);

    expect(screen.getByRole('heading', { name: 'שכר מצטבר והיסטוריה שנתית' })).toBeInTheDocument();
    expect(screen.getByText('סה״כ לתשלום בשנת 2026')).toBeInTheDocument();
    expect(screen.getByText(/14,650\.00/)).toBeInTheDocument();
    expect(screen.getByText('שבתות וימי מנוחה מצטברים')).toBeInTheDocument();
    expect(screen.getByText('תשלום ימי חג מצטבר')).toBeInTheDocument();
    expect(screen.getByText('תשלום חופשה מצטבר')).toBeInTheDocument();
    expect(screen.getByText('תשלום מחלה מצטבר')).toBeInTheDocument();
    expect(screen.getByText('הפרשות מעסיק מצטברות')).toBeInTheDocument();
    expect(screen.getByText('תשלומים ותוספות אחרים')).toBeInTheDocument();
    expect(screen.getByText('סך כל התוספות')).toBeInTheDocument();
    expect(screen.getByText('2026-01')).toBeInTheDocument();
    expect(screen.queryByText('2025-12')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('שנת הדוח'), { target: { value: '2025' } });

    expect(screen.getByText('סה״כ לתשלום בשנת 2025')).toBeInTheDocument();
    expect(screen.getByText('2025-12')).toBeInTheDocument();
    expect(screen.queryByText('2026-01')).not.toBeInTheDocument();
  });

  it('calculates Saturdays, additions and advances and saves the month cumulatively', () => {
    render(<PayrollPage />);

    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    const currentMonth = new Date().toISOString().slice(0, 7);
    const prorationStartDate = `${currentMonth}-16`;
    const year = Number(currentMonth.slice(0, 4));
    const month = Number(currentMonth.slice(5, 7));
    const daysInMonth = new Date(year, month, 0).getDate();
    const baseDays = Array.from({ length: daysInMonth }, (_, index) => index + 1).filter(
      (day) => new Date(year, month - 1, day).getDay() !== 6,
    );
    const paidBaseDays = baseDays.filter((day) => day >= 16).length;
    const proratedBaseSalary = Math.round(((7_000 * paidBaseDays) / baseDays.length) * 100) / 100;
    fireEvent.change(screen.getByLabelText('תאריך תחילת עבודה בחודש, לחישוב יחסי'), {
      target: { value: prorationStartDate },
    });
    fireEvent.change(screen.getByLabelText('מספר שבתות או ימי מנוחה שעבדו'), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByLabelText('תעריף לכל שבת או יום מנוחה'), {
      target: { value: '400' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.change(screen.getByLabelText('תוספת אחרת, אם קיימת'), {
      target: { value: '250' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.change(screen.getByLabelText('דמי כיס שכבר שולמו'), {
      target: { value: '100' },
    });
    fireEvent.change(screen.getByLabelText('מקדמות שכבר שולמו'), {
      target: { value: '500' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.click(screen.getByRole('button', { name: 'אישור ושמירה' }));

    expect(screen.getByText('השכר נשמר בהצלחה')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'שמירה מחדש' })).toBeInTheDocument();

    const saved = readMvpPayroll().find(
      (record) => record.month === new Date().toISOString().slice(0, 7),
    );
    expect(saved).toMatchObject({
      baseSalary: proratedBaseSalary,
      contractBaseSalary: 7_000,
      prorationStartDate,
      prorationDays: paidBaseDays,
      paidSaturdays: 3,
      saturdayRate: 400,
      saturdayPay: 1_200,
      otherAddition: 250,
      pocketMoney: 100,
      advances: 500,
      total: proratedBaseSalary + 850,
    });
  });

  it('creates one quarterly national-insurance tracking item after payroll save without requiring an amount', () => {
    render(<PayrollPage />);

    fireEvent.change(screen.getByLabelText('חודש שכר'), { target: { value: '2026-07' } });
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.click(screen.getByRole('button', { name: 'אישור ושמירה' }));

    expect(
      screen.getByText(/מעקב התשלום לביטוח לאומי הופעל לרבעון גם ללא סכום/),
    ).toBeInTheDocument();
    expect(screen.getByText('סכום טרם הוזן')).toBeInTheDocument();
    expect(readMvpEmploymentExpenses()).toEqual([
      expect.objectContaining({
        id: 'expense-national-insurance-2026-q3',
        category: 'ביטוח לאומי',
        frequency: 'quarterly',
        amount: 0,
        amountEntered: false,
        dueDate: '2026-10-15',
        status: 'upcoming',
        source: 'payroll-national-insurance',
        sourcePeriod: '2026-Q3',
      }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'שמירה מחדש' }));
    expect(readMvpEmploymentExpenses()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'עדכון פרטים' }));
    fireEvent.change(screen.getByLabelText(/^סכום בש״ח/), { target: { value: '720' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת עדכון' }));
    expect(readMvpEmploymentExpenses()[0]).toMatchObject({
      amount: 720,
      amountEntered: true,
      dueDate: '2026-10-15',
    });
  });

  it('blocks negative, non-numeric and unreasonable base payroll values', () => {
    render(<PayrollPage />);

    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.change(screen.getByLabelText('שכר בסיס'), {
      target: { value: '-1' },
    });
    fireEvent.change(screen.getByLabelText('ימי עבודה'), {
      target: { value: '9999' },
    });
    fireEvent.change(screen.getByLabelText('מספר שבתות או ימי מנוחה שעבדו'), {
      target: { value: '7' },
    });
    fireEvent.change(screen.getByLabelText('תעריף לכל שבת או יום מנוחה'), {
      target: { value: '10000001' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));

    expect(screen.getByRole('heading', { name: 'שכר בסיס ושבתות' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('שכר בסיס');
    expect(screen.getByRole('alert')).toHaveTextContent('ימי עבודה');
    expect(screen.getByRole('alert')).toHaveTextContent('שבתות בתשלום');
    expect(screen.getByRole('alert')).toHaveTextContent('תעריף שבת');
    expect(document.querySelector('[aria-describedby="payroll-baseSalary-error"]')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(document.querySelector('[aria-describedby="payroll-baseSalary-error"]')).toHaveClass(
      'field-input-error',
    );
    expect(document.querySelector('[aria-describedby="payroll-workDays-error"]')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(
      screen.getByText(/שכר בסיס: יש להזין סכום/, { selector: '.field-error-message' }),
    ).toBeInTheDocument();
  });

  it('advances for the exact July payroll values and counts four Saturdays', () => {
    render(<PayrollPage />);

    fireEvent.change(screen.getByLabelText('חודש שכר'), { target: { value: '2026-07' } });
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.change(screen.getByLabelText('תאריך תחילת עבודה בחודש, לחישוב יחסי'), {
      target: { value: '2026-07-12' },
    });
    fireEvent.change(screen.getByLabelText('מספר שבתות או ימי מנוחה שעבדו'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText('תעריף לכל שבת או יום מנוחה'), {
      target: { value: '440' },
    });

    expect(screen.getByText('18 מתוך 27 ימי בסיס')).toBeInTheDocument();
    expect(screen.getByText(/מהמכנה הוצאו 4 שבתות/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));

    expect(screen.getByRole('heading', { name: 'תוספות נוספות' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('blocks text and extreme values in additions and deductions', () => {
    render(<PayrollPage />);

    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.change(screen.getByLabelText('תשלום ימי חג'), {
      target: { value: 'not-a-number' },
    });
    fireEvent.change(screen.getByLabelText('תוספת אחרת, אם קיימת'), {
      target: { value: '10000001' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));

    expect(screen.getByRole('heading', { name: 'תוספות נוספות' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('תשלום ימי חג');
    expect(screen.getByRole('alert')).toHaveTextContent('תוספת אחרת');
  });

  it('adds multiple named additional payments to the saved calculation and print summary', () => {
    render(<PayrollPage />);

    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.click(screen.getByRole('button', { name: '＋ הוספת תשלום' }));
    fireEvent.change(screen.getByLabelText('תיאור תשלום נוסף 1'), {
      target: { value: 'בונוס חד־פעמי' },
    });
    fireEvent.change(screen.getByLabelText('סכום תשלום נוסף 1'), {
      target: { value: '350' },
    });
    fireEvent.click(screen.getByRole('button', { name: '＋ הוספת תשלום' }));
    fireEvent.change(screen.getByLabelText('תיאור תשלום נוסף 2'), {
      target: { value: 'החזר נסיעות' },
    });
    fireEvent.change(screen.getByLabelText('סכום תשלום נוסף 2'), {
      target: { value: '150' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    expect(screen.getAllByText('בונוס חד־פעמי')).toHaveLength(2);
    expect(screen.getAllByText('החזר נסיעות')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'אישור ושמירה' }));

    const saved = readMvpPayroll().find(
      (record) => record.month === new Date().toISOString().slice(0, 7),
    );
    expect(saved?.additionalPayments).toEqual([
      expect.objectContaining({ description: 'בונוס חד־פעמי', amount: 350 }),
      expect.objectContaining({ description: 'החזר נסיעות', amount: 150 }),
    ]);
    expect(saved?.total).toBe(7_500);
  });

  it('keeps values across back and forward navigation and calculates the summary from them', () => {
    render(<PayrollPage />);

    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.change(screen.getByLabelText('מספר שבתות או ימי מנוחה שעבדו'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText('תעריף לכל שבת או יום מנוחה'), {
      target: { value: '500' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.change(screen.getByLabelText('תוספת אחרת, אם קיימת'), {
      target: { value: '250' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.change(screen.getByLabelText('מקדמות שכבר שולמו'), {
      target: { value: '100' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'חזרה' }));
    expect(screen.getByLabelText('תוספת אחרת, אם קיימת')).toHaveValue(250);
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    expect(screen.getByLabelText('מקדמות שכבר שולמו')).toHaveValue(100);
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));

    expect(screen.getByRole('heading', { name: 'סיכום ואישור' })).toBeInTheDocument();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    expect(screen.queryByRole('button', { name: 'הדפסה / שמירה כ־PDF' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'תצוגה מקדימה להדפסה' }));
    expect(screen.getByText('תצוגה מקדימה לפני הדפסה')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'הדפסה / שמירה כ־PDF' }));
    expect(printSpy).toHaveBeenCalledOnce();
    printSpy.mockRestore();
    const printableSummary = screen.getByLabelText('ריכוז שכר חודשי להדפסה');
    expect(printableSummary).toHaveTextContent('חתימת העובד/ת / Caregiver signature');
    expect(printableSummary).toHaveTextContent('Monthly pay summary');
    expect(printableSummary).toHaveTextContent('Base salary');
    expect(printableSummary).toHaveTextContent('Saturdays and rest days');
    expect(printableSummary).toHaveTextContent('Holiday pay');
    expect(printableSummary).toHaveTextContent('Vacation pay');
    expect(printableSummary).toHaveTextContent('Sick pay');
    expect(printableSummary).toHaveTextContent('Employer contributions');
    expect(printableSummary).toHaveTextContent('Other addition');
    expect(printableSummary).toHaveTextContent('Net amount payable');
    expect(printableSummary).toHaveTextContent('Advances');
    expect(screen.getByText('סכום לפני קיזוזים / Total before deductions')).toBeInTheDocument();
    expect(screen.queryByText('כלל התוספות')).not.toBeInTheDocument();
    expect(screen.queryByText('מתוכם דמי כיס')).not.toBeInTheDocument();
    expect(screen.getAllByText(/8,150\.00/)).toHaveLength(2);
  });
});

const LIABILITY_CALCULATION_HE =
  'החישוב מסכם אריתמטית את הסכומים והימים שהוזנו. הוא אינו קובע זכויות או שיעורי תשלום ואינו תחליף לתלוש שכר או לבדיקה של גורם מקצועי.';

/** Intl inserts bidi marks around currency; strip them before comparing text. */
function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/[\u200e\u200f\u061c]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function plainText(element: Element | null | undefined): string {
  return normalizeText(element?.textContent);
}

/**
 * `textContent` concatenates adjacent elements with nothing between them, so a
 * label and a value that sit on two separate lines come back glued together:
 * `דמי ביטוח266.44 ₪`. That is a property of the DOM API, not a defect in the
 * markup - the two are grid children with a gap, and a reader sees them on
 * separate rows. Reading the element children and joining them restores the
 * separation the layout already has, so the assertions can stay written the way
 * a person would read the card.
 */
function stackedText(element: Element | null | undefined): string {
  if (!element) return '';
  // Recursive, because the nesting is two deep in places: the month header wraps
  // its label and its value in one span, and stopping at the top level would
  // leave those two glued to each other while separating the index in front of
  // them. Walking to the leaves treats every element boundary the same way.
  const parts: string[] = [];
  for (const node of Array.from(element.childNodes)) {
    const text =
      node.nodeType === 1 ? stackedText(node as Element) : normalizeText(node.textContent);
    if (text.length > 0) parts.push(text);
  }
  return parts.join(' ');
}

function payrollRecord(month: string, overrides: Partial<MvpPayrollRecord> = {}): MvpPayrollRecord {
  return {
    id: `pay-${month}`,
    month,
    baseSalary: 7_000,
    workDays: 26,
    paidSaturdays: 0,
    saturdayPay: 0,
    pocketMoney: 0,
    otherAddition: 0,
    advances: 0,
    agreedDeduction: 0,
    total: 7_000,
    savedAt: `${month}-28T12:00:00.000Z`,
    ...overrides,
  };
}

describe('national insurance wage period', () => {
  it('anchors a quarterly period on the month before the due date', () => {
    // The Q3 payment falls due on 15 October and covers July to September.
    expect(nationalInsuranceWageMonths('quarterly', '2026-10-15')).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
    expect(nationalInsuranceWageMonths('quarterly', '2026-01-15')).toEqual([
      '2025-10',
      '2025-11',
      '2025-12',
    ]);
  });

  it('covers a single month for monthly and one-time payments', () => {
    expect(nationalInsuranceWageMonths('monthly', '2026-05-15')).toEqual(['2026-04']);
    expect(nationalInsuranceWageMonths('one_time', '2026-01-05')).toEqual(['2025-12']);
  });

  it('covers twelve months for an annual payment', () => {
    const months = nationalInsuranceWageMonths('annual', '2026-04-15');
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2025-04');
    expect(months[11]).toBe('2026-03');
  });

  it('falls back to the current month when no due date was entered yet', () => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    expect(nationalInsuranceWageMonths('monthly', '')).toEqual(
      nationalInsuranceWageMonths('monthly', `${currentMonth}-15`),
    );
    expect(nationalInsuranceWageMonths('monthly', 'not-a-date')).toHaveLength(1);
  });
});

describe('national insurance wage base and amount', () => {
  it('counts wage additions but not employer contributions or deductions', () => {
    expect(
      recordedGrossWage(
        payrollRecord('2026-07', {
          saturdayPay: 400,
          holidayPay: 100,
          vacationPay: 50,
          sickPay: 25,
          otherAddition: 200,
          additionalPayments: [{ id: 'a', description: 'בונוס', amount: 125 }],
          employerContributions: 900,
          pocketMoney: 300,
          advances: 500,
          agreedDeduction: 100,
        }),
      ),
    ).toBe(7_900);
  });

  it('rounds to agorot and never returns NaN', () => {
    expect(DEFAULT_NATIONAL_INSURANCE_RATE_PERCENT).toBe(3.6);
    // 8150 * 3.6 / 100 is 293.40000000000003 in binary floating point.
    expect(nationalInsuranceAmount(8_150, 3.6)).toBe(293.4);
    expect(nationalInsuranceAmount(21_500, 3.6)).toBe(774);
    expect(nationalInsuranceAmount(7_333.33, 3.6)).toBe(264);
    expect(nationalInsuranceAmount(0, 3.6)).toBe(0);
    expect(nationalInsuranceAmount(-100, 3.6)).toBe(0);
    expect(nationalInsuranceAmount(Number.NaN, 3.6)).toBe(0);
    expect(nationalInsuranceAmount(7_000, Number.NaN)).toBe(0);
  });
});

describe('national insurance monthly reporting lines', () => {
  const months = ['2026-07', '2026-08', '2026-09'];

  it('fills each line from that month and falls back to the contract salary', () => {
    const records = [payrollRecord('2026-07', { saturdayPay: 400 }), payrollRecord('2026-09')];

    const rows = nationalInsuranceMonthRows(records, months, 7_000, '3.6', {}, '2026-12');

    expect(rows.map((row) => [row.month, row.wage, row.wageSource, row.amount])).toEqual([
      ['2026-07', 7_400, 'payroll-records', 266.4],
      ['2026-08', 7_000, 'contract-base-salary', 252],
      ['2026-09', 7_000, 'payroll-records', 252],
    ]);
    expect(nationalInsuranceTotals(rows)).toEqual({ wages: 21_400, amount: 770.4 });
  });

  it('leaves a line empty rather than guessing when there is no wage at all', () => {
    const rows = nationalInsuranceMonthRows([], months, null, '3.6', {}, '2026-12');

    expect(rows.every((row) => row.wageValue === '' && row.wageSource === 'none')).toBe(true);
    expect(nationalInsuranceTotals(rows)).toEqual({ wages: 0, amount: 0 });
  });

  it('reports a month marked "לא" as zero and keeps its wage out of the totals', () => {
    const rows = nationalInsuranceMonthRows(
      [],
      months,
      7_000,
      '3.6',
      { '2026-08': { employed: false } },
      '2026-12',
    );

    expect(rows[1]).toMatchObject({ employed: false, wage: 0, amount: 0 });
    expect(rows[1]?.wageValue).toBe('7000');
    expect(nationalInsuranceTotals(rows)).toEqual({ wages: 14_000, amount: 504 });
  });

  it('closes a month later than today and does not let an override reopen it', () => {
    const rows = nationalInsuranceMonthRows(
      [],
      months,
      7_000,
      '3.6',
      { '2026-09': { employed: true } },
      '2026-08',
    );

    expect(rows.map((row) => row.isFuture)).toEqual([false, false, true]);
    expect(rows[2]).toMatchObject({ employed: false, wage: 0, amount: 0 });
    expect(nationalInsuranceTotals(rows)).toEqual({ wages: 14_000, amount: 504 });
  });

  it('takes the shared rate per line and lets one line depart from it', () => {
    const shared = nationalInsuranceMonthRows([], months, 7_000, '4', {}, '2026-12');
    expect(shared.map((row) => row.ratePercent)).toEqual([4, 4, 4]);
    expect(nationalInsuranceTotals(shared)).toEqual({ wages: 21_000, amount: 840 });

    const departed = nationalInsuranceMonthRows(
      [],
      months,
      7_000,
      '4',
      { '2026-07': { rate: '3.6' } },
      '2026-12',
    );
    expect(departed.map((row) => row.amount)).toEqual([252, 280, 280]);
    expect(nationalInsuranceTotals(departed)).toEqual({ wages: 21_000, amount: 812 });
  });

  it('keeps whole shekels in the wage and agorot in the amount, and never yields NaN', () => {
    const rows = nationalInsuranceMonthRows(
      [payrollRecord('2026-07', { saturdayPay: 149.6 })],
      months,
      null,
      '3.6',
      { '2026-08': { wage: '' }, '2026-09': { wage: 'לא מספר' } },
      '2026-12',
    );

    // 7000 + 149.6 rounds to 7150 on the line, and 7150 x 3.6% is 257.4.
    expect(rows[0]).toMatchObject({ wage: 7_150, amount: 257.4 });
    expect(rows[1]).toMatchObject({ wage: 0, amount: 0 });
    expect(rows[2]).toMatchObject({ wage: 0, amount: 0 });
    expect(nationalInsuranceTotals(rows)).toEqual({ wages: 7_150, amount: 257.4 });
    expect(
      Object.values(nationalInsuranceTotals(rows)).every((value) => Number.isFinite(value)),
    ).toBe(true);
  });

  it('names a month the way the Institute form prints it', () => {
    const names = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני'];
    expect(hebrewMonthLabel('2026-03', names)).toBe('מרץ 2026');
    expect(hebrewMonthLabel('2026-11', names)).toBe('2026-11');
  });
});

describe('PayrollPage national insurance monthly report', () => {
  /**
   * A quarter far enough in the past that "later than the current month" can
   * never leak into it, and one far enough ahead that it stays future. The
   * page reads the real clock at import time, so the fixtures — not a fake
   * timer — are what make these assertions stable.
   */
  const PAST_DUE_DATE = '2020-10-15';
  const FUTURE_DUE_DATE = '2999-10-15';

  function renderPage() {
    return render(
      <I18nextProvider i18n={initI18n()}>
        <PayrollPage />
      </I18nextProvider>,
    );
  }

  function calculator(): HTMLElement {
    const element = document.querySelector<HTMLElement>('.national-insurance-calculator');
    if (!element) throw new Error('the national insurance calculator is not on screen');
    return element;
  }

  function reportingLines(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.ni-month-row'));
  }

  /**
   * R5-01..R5-04: the provenance badge now sits inside the amount cell and
   * inside the two summary rows, and it carries a visible word plus a
   * screen-reader sentence. The arithmetic assertions below are about the
   * arithmetic, so the badge is stripped here and asserted on its own — that
   * keeps every pre-existing expectation exact instead of loosening it.
   */
  function withoutOriginBadges(element: Element | null | undefined): Element | null {
    if (!element) return null;
    const clone = element.cloneNode(true) as Element;
    for (const badge of Array.from(clone.querySelectorAll('.value-origin'))) badge.remove();
    return clone;
  }

  function lineAmount(index: number): string {
    return stackedText(
      withoutOriginBadges(reportingLines()[index]?.querySelector('.ni-month-amount')),
    );
  }

  function summaryLines(): string[] {
    return Array.from(calculator().querySelectorAll('.payroll-live-total')).map((element) =>
      stackedText(withoutOriginBadges(element)),
    );
  }

  function employedField(month: string): HTMLElement {
    return screen.getByLabelText(`האם הייתה העסקה בחודש ${month}`);
  }

  function wageField(month: string): HTMLElement {
    return screen.getByLabelText(`שכר ששולם בחודש (ללא אג׳) ${month}`);
  }

  function rateField(month: string): HTMLElement {
    return screen.getByLabelText(`שיעור דמי הביטוח לחודש ${month}`);
  }

  function enterDueDate(dueDate: string) {
    fireEvent.change(screen.getByLabelText(/^תאריך יעד/), {
      target: { value: dueDate },
    });
  }

  beforeEach(() => {
    localStorage.clear();
    saveMvpProfile({
      ...emptyMvpProfile,
      baseSalary: 7_000,
      salaryEffectiveDate: '2019-01-01',
    });
    saveMvpPayroll([
      payrollRecord('2020-07', { saturdayPay: 400, total: 7_400 }),
      payrollRecord('2020-08'),
      payrollRecord('2020-09', { holidayPay: 100, total: 7_100 }),
    ]);
  });

  it('opens one reporting line per month of the quarter, filled from that month', () => {
    renderPage();

    enterDueDate(PAST_DUE_DATE);

    expect(reportingLines()).toHaveLength(3);
    expect(
      reportingLines().map((line) => stackedText(line.querySelector('.ni-month-name'))),
    ).toEqual(['1 חודש העסקה יולי 2020', '2 חודש העסקה אוגוסט 2020', '3 חודש העסקה ספטמבר 2020']);
    expect(wageField('יולי 2020')).toHaveValue(7_400);
    expect(wageField('אוגוסט 2020')).toHaveValue(7_000);
    expect(wageField('ספטמבר 2020')).toHaveValue(7_100);
    expect(rateField('יולי 2020')).toHaveValue(DEFAULT_NATIONAL_INSURANCE_RATE_PERCENT);
    expect(lineAmount(0)).toBe('דמי ביטוח 266.40 ₪');
    expect(lineAmount(1)).toBe('דמי ביטוח 252.00 ₪');
    expect(lineAmount(2)).toBe('דמי ביטוח 255.60 ₪');
    expect(plainText(calculator().querySelector('.form-note'))).toBe(
      'השכר לחודשים 2020-07, 2020-08, 2020-09 מולא מרישומי השכר השמורים. אפשר לתקן כל שורה.',
    );
    expect(plainText(calculator().querySelector('.legal-note'))).toBe(LIABILITY_CALCULATION_HE);
  });

  it('sums the lines into the two summary rows and into the amount field', () => {
    renderPage();

    enterDueDate(PAST_DUE_DATE);

    expect(summaryLines()[0]).toBe('סה״כ שכר ששולם 21,500.00 ₪');
    expect(summaryLines()[1]).toContain('סה״כ לתשלום');
    expect(summaryLines()[1]).toContain('774.00 ₪');
    expect(summaryLines()[1]).toContain('סכום השורות של 3 חודשי העסקה');
    expect(screen.getByLabelText(/^סכום בש״ח/)).toHaveValue(774);
  });

  it('reports a month marked לא as zero and locks its wage', () => {
    renderPage();

    enterDueDate(PAST_DUE_DATE);
    fireEvent.change(employedField('אוגוסט 2020'), {
      target: { value: 'no' },
    });

    expect(wageField('אוגוסט 2020')).toBeDisabled();
    expect(rateField('אוגוסט 2020')).toBeDisabled();
    expect(reportingLines()[1]?.className).toContain('is-not-employed');
    expect(lineAmount(1)).toBe('דמי ביטוח 0.00 ₪');
    expect(summaryLines()[0]).toBe('סה״כ שכר ששולם 14,500.00 ₪');
    expect(screen.getByLabelText(/^סכום בש״ח/)).toHaveValue(522);

    fireEvent.change(employedField('אוגוסט 2020'), {
      target: { value: 'yes' },
    });
    expect(wageField('אוגוסט 2020')).not.toBeDisabled();
    expect(screen.getByLabelText(/^סכום בש״ח/)).toHaveValue(774);
  });

  it('closes a month later than the current month and says so in the form\u2019s own words', () => {
    renderPage();

    enterDueDate(FUTURE_DUE_DATE);

    for (const month of ['יולי', 'אוגוסט', 'ספטמבר']) {
      expect(employedField(`${month} 2999`)).toBeDisabled();
      expect(employedField(`${month} 2999`)).toHaveValue('no');
      expect(wageField(`${month} 2999`)).toBeDisabled();
    }
    expect(plainText(reportingLines()[2]?.querySelector('.ni-month-future'))).toBe(
      'ספטמבר (עתידי) לא ניתן לדווח',
    );
    expect(reportingLines()[2]?.className).toContain('is-future');
    expect(summaryLines()[0]).toBe('סה״כ שכר ששולם 0.00 ₪');
    expect(screen.getByLabelText(/^סכום בש״ח/)).toHaveValue(null);
    expect(plainText(calculator())).not.toContain('NaN');
  });

  it('drives every line from the shared rate and lets one line depart from it', () => {
    renderPage();

    enterDueDate(PAST_DUE_DATE);
    fireEvent.change(screen.getByLabelText(/^שיעור התשלום/), {
      target: { value: '4' },
    });

    expect(rateField('יולי 2020')).toHaveValue(4);
    expect(rateField('ספטמבר 2020')).toHaveValue(4);
    expect(screen.getByLabelText(/^סכום בש״ח/)).toHaveValue(860);

    fireEvent.change(rateField('יולי 2020'), { target: { value: '3.6' } });

    expect(lineAmount(0)).toBe('דמי ביטוח 266.40 ₪');
    expect(rateField('אוגוסט 2020')).toHaveValue(4);
    expect(screen.getByLabelText(/^סכום בש״ח/)).toHaveValue(830.4);
  });

  it('keeps an emptied wage at zero rather than NaN', () => {
    renderPage();

    enterDueDate(PAST_DUE_DATE);
    fireEvent.change(wageField('יולי 2020'), { target: { value: '' } });

    expect(lineAmount(0)).toBe('דמי ביטוח 0.00 ₪');
    expect(summaryLines()[0]).toBe('סה״כ שכר ששולם 14,100.00 ₪');
    expect(screen.getByLabelText(/^סכום בש״ח/)).toHaveValue(507.6);
    expect(plainText(calculator())).not.toContain('NaN');
  });

  it('reports the wage in whole shekels and the insurance to agorot', () => {
    renderPage();

    enterDueDate(PAST_DUE_DATE);
    fireEvent.change(wageField('יולי 2020'), { target: { value: '7400.75' } });

    // 7,400.75 is reported as 7,401 "ללא אג׳", and 7,401 x 3.6% is 266.436.
    expect(lineAmount(0)).toBe('דמי ביטוח 266.44 ₪');
    expect(summaryLines()[0]).toBe('סה״כ שכר ששולם 21,501.00 ₪');
    expect(screen.getByLabelText(/^סכום בש״ח/)).toHaveValue(774.04);
  });

  it('lets a typed amount override the total and saves the typed one', () => {
    renderPage();

    enterDueDate(PAST_DUE_DATE);
    expect(screen.getByLabelText(/^סכום בש״ח/)).toHaveValue(774);

    fireEvent.change(screen.getByLabelText(/^סכום בש״ח/), {
      target: { value: '900' },
    });
    expect(screen.getByLabelText(/^סכום בש״ח/)).toHaveValue(900);
    expect(summaryLines()[1]).toContain('774.00 ₪');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'הוספת תשלום למעקב',
      }),
    );

    expect(readMvpEmploymentExpenses()).toEqual([
      expect.objectContaining({
        category: 'ביטוח לאומי',
        frequency: 'quarterly',
        amount: 900,
        amountEntered: true,
        dueDate: PAST_DUE_DATE,
      }),
    ]);
  });

  it('saves the total to pay when the customer does not override it', () => {
    renderPage();

    enterDueDate(PAST_DUE_DATE);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'הוספת תשלום למעקב',
      }),
    );

    expect(readMvpEmploymentExpenses()[0]).toMatchObject({ amount: 774, amountEntered: true });
  });

  it('hides the reporting table when the category is not national insurance', () => {
    renderPage();

    enterDueDate(PAST_DUE_DATE);
    expect(document.querySelector('.national-insurance-calculator')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^סוג התשלום/), {
      target: { value: 'ביטוח רפואי' },
    });

    expect(document.querySelector('.national-insurance-calculator')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.ni-month-row')).toHaveLength(0);
    expect(screen.queryByLabelText(/^שיעור התשלום/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^סכום בש״ח/)).toHaveValue(null);
  });

  /**
   * R5-02. The Institute's line is wage x rate. The wage and the rate are two
   * fields the customer fills; the amount beside them is neither, and before
   * this it was rendered exactly like them.
   */
  it('marks every insurance line amount as calculated, not as something typed', () => {
    renderPage();

    enterDueDate(PAST_DUE_DATE);

    const badges = reportingLines().map((line) =>
      line.querySelector('.ni-month-amount .value-origin'),
    );
    expect(badges).toHaveLength(3);
    for (const badge of badges) {
      expect(badge).toHaveAttribute('data-value-origin', 'calculated');
      expect(badge?.textContent).toContain('מחושב');
    }
  });

  it('marks both insurance totals as calculated and names the calculator as their source', () => {
    renderPage();

    enterDueDate(PAST_DUE_DATE);

    const totals = Array.from(calculator().querySelectorAll('.payroll-live-total .value-origin'));
    expect(totals).toHaveLength(2);
    expect(totals.every((badge) => badge.getAttribute('data-value-origin') === 'calculated')).toBe(
      true,
    );
    expect(totals[1]?.textContent).toContain('מחשבון ביטוח לאומי');
  });

  /**
   * R5-01 / R5-02. The same field carries either kind, and which one it is
   * depends on what the customer just did. This is the one place in the product
   * where a number changes provenance under the user's hands, so it is the one
   * place where getting the badge wrong would be actively misleading.
   */
  it('flips the amount field from calculated to entered when the customer types over it', () => {
    renderPage();

    enterDueDate(PAST_DUE_DATE);

    const amountBadge = () =>
      screen
        .getByLabelText(/^סכום בש״ח/)
        .closest('label')
        ?.querySelector('.value-origin');
    expect(amountBadge()).toHaveAttribute('data-value-origin', 'calculated');
    expect(amountBadge()?.textContent).toContain('מחשבון ביטוח לאומי');

    fireEvent.change(screen.getByLabelText(/^סכום בש״ח/), { target: { value: '900' } });

    expect(amountBadge()).toHaveAttribute('data-value-origin', 'input');
    expect(amountBadge()?.textContent).toContain('הוזן');
  });

  /**
   * R5-03. "שולם" is a claim that money left the account. An expense the
   * customer has recorded but not marked paid must not make it.
   */
  it('says שולם only for an expense the customer marked as paid', () => {
    renderPage();

    enterDueDate(PAST_DUE_DATE);
    fireEvent.click(screen.getByRole('button', { name: 'הוספת תשלום למעקב' }));

    const row = document.querySelector('.employment-expenses > div');
    expect(row?.querySelector('.value-origin')).toHaveAttribute('data-value-origin', 'input');

    fireEvent.click(screen.getByRole('button', { name: 'סימון כשולם' }));

    const paidRow = document.querySelector('.employment-expenses > div');
    expect(paidRow?.querySelector('.value-origin')).toHaveAttribute('data-value-origin', 'paid');
    expect(paidRow?.querySelector('.value-origin')?.textContent).toContain('שולם');
  });

  it('states the key to the four kinds above the periodic payments, not below them', () => {
    renderPage();

    // The section that owns the periodic-payment form is the one holding the
    // national insurance calculator.
    const section = calculator().closest('section')!;
    const legend = section.querySelector('.value-origin-legend')!;
    const form = section.querySelector('form')!;
    expect(legend).not.toBeNull();
    // "Above the list" is the placement rule in LIABILITY-FRAMING.md, and the
    // legend obeys it too: the reader meets the rule before the numbers.
    expect(legend.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(legend.textContent).toContain('הוזן');
    expect(legend.textContent).toContain('מחושב');
    expect(legend.textContent).toContain('שולם');
  });
});

describe('PayrollPage wizard summary — R5-01 / R5-02', () => {
  beforeEach(() => {
    localStorage.clear();
    saveMvpProfile({
      ...emptyMvpProfile,
      baseSalary: 7_000,
      salaryEffectiveDate: '2025-01-01',
    });
  });

  function renderWizard() {
    return render(
      <I18nextProvider i18n={initI18n()}>
        <PayrollPage />
      </I18nextProvider>,
    );
  }

  /**
   * The monthly summary is the screen the employer prints and hands over, so it
   * is the screen where an unmarked number is most likely to be read as a
   * payslip. Every money line on it must say which kind of claim it is.
   */
  it('marks every line of the monthly summary as calculated, and none of them as paid', () => {
    renderWizard();

    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.change(screen.getByLabelText('מספר שבתות או ימי מנוחה שעבדו'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText('תעריף לכל שבת או יום מנוחה'), {
      target: { value: '400' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));

    const summary = document.querySelector('.pay-summary');
    expect(summary).not.toBeNull();
    const kinds = Array.from(summary!.querySelectorAll('.value-origin')).map((badge) =>
      badge.getAttribute('data-value-origin'),
    );
    // Base, Saturdays, other additions, the subtotal, deductions and the total
    // are all derived; nothing on this screen is `paid`, because the month has
    // not been closed and no payment date exists yet.
    expect(kinds).toHaveLength(6);
    expect(new Set(kinds)).toEqual(new Set(['calculated']));
    expect(kinds).not.toContain('paid');
    expect(summary!.textContent).toContain('מחושב');
  });

  it('shows the key to the badges from step 2 on, and not on the month step', () => {
    renderWizard();

    expect(document.querySelector('.wizard-content .value-origin-legend')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));

    expect(document.querySelector('.wizard-content .value-origin-legend')).not.toBeNull();
  });

  it('marks the running totals inside the wizard as calculated', () => {
    renderWizard();

    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));

    const totals = Array.from(
      document.querySelectorAll('.wizard-content .payroll-live-total .value-origin'),
    );
    expect(totals.length).toBeGreaterThan(0);
    expect(totals.every((badge) => badge.getAttribute('data-value-origin') === 'calculated')).toBe(
      true,
    );
  });
});

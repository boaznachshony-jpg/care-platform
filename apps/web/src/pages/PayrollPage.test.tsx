import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyMvpProfile,
  readMvpEmploymentExpenses,
  readMvpPayroll,
  saveMvpPayroll,
  saveMvpProfile,
} from '../storage/mvp-storage.js';
import { monthsInRange, nextSequencePayrollValues, PayrollPage } from './PayrollPage.js';

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

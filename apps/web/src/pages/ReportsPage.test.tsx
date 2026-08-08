import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { initI18n } from '@caredesk/i18n';
import { saveMvpPayroll } from '../storage/mvp-storage.js';
import { ReportsPage } from './ReportsPage.js';

async function renderPage(language: 'he' | 'en') {
  const i18n = initI18n();
  await i18n.changeLanguage(language);
  return render(
    <I18nextProvider i18n={i18n}>
      <ReportsPage />
    </I18nextProvider>,
  );
}

describe('ReportsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    saveMvpPayroll([
      {
        id: 'jan',
        month: '2026-01',
        baseSalary: 7_000,
        workDays: 24,
        vacationDays: 2,
        sickDays: 1,
        paidHolidays: 1,
        paidSaturdays: 1,
        saturdayPay: 500,
        holidayPay: 300,
        vacationPay: 200,
        sickPay: 100,
        employerContributions: 700,
        otherAddition: 50,
        additionalPayments: [{ id: 'bonus', description: 'bonus', amount: 150 }],
        pocketMoney: 100,
        advances: 400,
        agreedDeduction: 50,
        total: 8_450,
        savedAt: '2026-01-31T12:00:00.000Z',
      },
      {
        id: 'legacy',
        month: '2026-02',
        baseSalary: 7_000,
        workDays: 24,
        paidSaturdays: 0,
        saturdayPay: 0,
        pocketMoney: 0,
        otherAddition: 0,
        advances: 0,
        agreedDeduction: 0,
        total: 7_000,
        savedAt: '2026-02-28T12:00:00.000Z',
      },
    ]);
  });

  it('renders the cumulative report in Hebrew and explains legacy zero values', async () => {
    const { container } = await renderPage('he');
    expect(screen.getByRole('heading', { name: 'דוח שכר מצטבר' })).toBeInTheDocument();
    expect(screen.getByText('חודשים עם נתונים').nextSibling).toHaveTextContent('2');
    expect(screen.getByRole('rowheader', { name: 'שכר בסיס' })).toBeInTheDocument();
    expect(screen.getByText(/ערכים חסרים מוצגים כאפס/)).toBeInTheDocument();
    expect(screen.getByText(/אינו מהווה אסמכתה/)).toBeInTheDocument();
    expect(container.querySelector('.reports-page')).toHaveAttribute('dir', 'rtl');
  });

  it('renders every report label in English with LTR direction', async () => {
    const { container } = await renderPage('en');
    expect(screen.getByRole('heading', { name: 'Cumulative payroll report' })).toBeInTheDocument();
    expect(screen.getByLabelText('From month')).toBeInTheDocument();
    expect(
      screen.queryByRole('rowheader', { name: 'Employee contributions' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Employer contributions' })).toBeInTheDocument();
    expect(container.querySelector('.reports-page')).toHaveAttribute('dir', 'ltr');
  });

  it('rejects an inverted month range without showing misleading totals', async () => {
    await renderPage('en');
    fireEvent.change(screen.getByLabelText('From month'), { target: { value: '2026-02' } });
    fireEvent.change(screen.getByLabelText('To month'), { target: { value: '2026-01' } });
    expect(screen.getByRole('alert')).toHaveTextContent('start month');
    expect(screen.queryByText('Calculated final payroll')).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = await renderPage('he');
    expect(await axe(container)).toHaveNoViolations();
  });
});

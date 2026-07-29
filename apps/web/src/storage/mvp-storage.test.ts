import { beforeEach, describe, expect, it } from 'vitest';
import {
  emptyMvpProfile,
  readMvpDocuments,
  readMvpEmploymentExpenses,
  readMvpPayroll,
  readMvpProfile,
  saveMvpDocuments,
  saveMvpEmploymentExpenses,
  saveMvpPayroll,
  saveMvpProfile,
} from './mvp-storage.js';

describe('MVP local storage', () => {
  beforeEach(() => localStorage.clear());

  it('merges newly added profile fields into older saved profiles', () => {
    localStorage.setItem(
      'caredesk.mvp.profile.v1',
      JSON.stringify({ employerName: 'בועז', onboardingCompleted: true }),
    );
    expect(readMvpProfile()).toEqual({
      ...emptyMvpProfile,
      employerName: 'בועז',
      onboardingCompleted: true,
    });
  });

  it('persists employment salary settings', () => {
    saveMvpProfile({ ...emptyMvpProfile, baseSalary: 7000, salaryEffectiveDate: '2026-01-01' });
    expect(readMvpProfile().baseSalary).toBe(7000);
  });

  it('persists documents and payroll records', () => {
    saveMvpDocuments([
      {
        id: 'doc-1',
        name: 'דרכון',
        category: 'דרכון',
        dateLabel: 'בתוקף',
        status: 'valid',
        fileName: 'passport.pdf',
        fileType: 'application/pdf',
        dataUrl: 'data:application/pdf;base64,dGVzdA==',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    ]);
    saveMvpPayroll([
      {
        id: 'pay-1',
        month: '2026-07',
        baseSalary: 7000,
        workDays: 26,
        paidSaturdays: 4,
        saturdayPay: 1000,
        pocketMoney: 0,
        otherAddition: 0,
        advances: 100,
        agreedDeduction: 0,
        total: 7900,
        savedAt: '2026-07-29T00:00:00.000Z',
      },
    ]);
    expect(readMvpDocuments()).toHaveLength(1);
    expect(readMvpPayroll()[0]?.total).toBe(7900);
  });

  it('persists periodic employment expenses', () => {
    saveMvpEmploymentExpenses([
      {
        id: 'expense-1',
        category: 'ביטוח לאומי',
        frequency: 'quarterly',
        amount: 1840,
        dueDate: '2026-09-30',
        status: 'upcoming',
        note: 'רבעון שלישי',
        savedAt: '2026-07-29T00:00:00.000Z',
      },
    ]);
    expect(readMvpEmploymentExpenses()[0]).toMatchObject({
      category: 'ביטוח לאומי',
      frequency: 'quarterly',
      amount: 1840,
    });
  });
});

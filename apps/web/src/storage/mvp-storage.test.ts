import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMvpClient,
  emptyMvpProfile,
  readMvpDocuments,
  readMvpClients,
  readMvpEmploymentExpenses,
  readMvpPayroll,
  readMvpProfile,
  readMvpTasks,
  saveMvpDocuments,
  saveMvpEmploymentExpenses,
  saveMvpPayroll,
  saveMvpProfile,
} from './mvp-storage.js';

describe('MVP local storage', () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, '', '/');
  });
  afterEach(() => history.replaceState({}, '', '/'));

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

  it('creates and updates an open medical-insurance renewal task from the saved expiry date', () => {
    saveMvpProfile({
      ...emptyMvpProfile,
      medicalInsuranceConfirmed: true,
      medicalInsuranceExpiryDate: '2027-06-30',
    });

    expect(readMvpTasks()).toContainEqual(
      expect.objectContaining({
        title: 'חידוש ביטוח רפואי',
        dueDate: '2027-06-30',
        status: 'open',
        source: 'medical-insurance',
      }),
    );

    saveMvpProfile({
      ...readMvpProfile(),
      medicalInsuranceExpiryDate: '2027-07-31',
    });
    expect(readMvpTasks().filter((task) => task.source === 'medical-insurance')).toEqual([
      expect.objectContaining({ dueDate: '2027-07-31', status: 'open' }),
    ]);
  });

  it('encrypts sensitive business values in the device cache', () => {
    const employerName = 'Sensitive Employer Marker';
    saveMvpProfile({ ...emptyMvpProfile, employerName, baseSalary: 7000 });

    const stored = localStorage.getItem('caredesk.mvp.profile.v1');
    expect(stored).toMatch(/^caredesk-encrypted-v1:/);
    expect(stored).not.toContain(employerName);
    expect(stored).not.toContain('7000');
    expect(readMvpProfile()).toMatchObject({ employerName, baseSalary: 7000 });
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
        dueDate: '2026-10-20',
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

  it('keeps profiles and lists isolated between clients', () => {
    const first = createMvpClient();
    const second = createMvpClient();

    history.replaceState({}, '', `/clients/${first.id}`);
    saveMvpProfile({ ...emptyMvpProfile, employerName: 'מעסיק ראשון' });
    saveMvpDocuments([
      {
        id: 'first-document',
        name: 'מסמך ראשון',
        category: 'אחר',
        dateLabel: 'בתוקף',
        status: 'valid',
        fileName: 'first.pdf',
        fileType: 'application/pdf',
        updatedAt: '2026-08-02T00:00:00.000Z',
      },
    ]);

    history.replaceState({}, '', `/clients/${second.id}`);
    saveMvpProfile({ ...emptyMvpProfile, employerName: 'מעסיק שני' });

    expect(readMvpProfile().employerName).toBe('מעסיק שני');
    expect(readMvpDocuments()).toHaveLength(0);
    history.replaceState({}, '', `/clients/${first.id}`);
    expect(readMvpProfile().employerName).toBe('מעסיק ראשון');
    expect(readMvpDocuments()[0]?.id).toBe('first-document');
  });

  it('migrates legacy data into a client without deleting the original copy', () => {
    localStorage.setItem(
      'caredesk.mvp.profile.v1',
      JSON.stringify({ ...emptyMvpProfile, employerName: 'מעסיק ותיק', onboardingCompleted: true }),
    );

    const [migrated] = readMvpClients();

    expect(migrated?.employerName).toBe('מעסיק ותיק');
    expect(localStorage.getItem('caredesk.mvp.profile.v1')).not.toBeNull();
    history.replaceState({}, '', `/clients/${migrated?.id}`);
    expect(readMvpProfile().employerName).toBe('מעסיק ותיק');
  });
});

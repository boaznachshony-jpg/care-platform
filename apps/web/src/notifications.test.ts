import { describe, expect, it } from 'vitest';
import { createCareNotifications } from './notifications.js';

describe('care notifications', () => {
  it('collects overdue and upcoming items from tasks, documents and expenses', () => {
    const notifications = createCareNotifications({
      today: new Date('2026-08-10T12:00:00'),
      employmentStartDate: '2026-07-01',
      reminderLeadDays: 7,
      tasks: [
        {
          id: 'task-1',
          title: 'הכנת שכר',
          dueDate: '2026-08-09',
          priority: 'important',
          status: 'open',
          createdAt: '2026-08-01T12:00:00.000Z',
        },
      ],
      documents: [
        {
          id: 'document-1',
          name: 'דרכון',
          category: 'דרכון',
          dateLabel: 'בתוקף עד 15.08.2026',
          status: 'valid',
          fileName: 'passport.pdf',
          fileType: 'application/pdf',
          updatedAt: '2026-08-01T12:00:00.000Z',
        },
      ],
      expenses: [
        {
          id: 'expense-1',
          category: 'ביטוח לאומי',
          frequency: 'quarterly',
          amount: 1_800,
          dueDate: '2026-08-10',
          status: 'upcoming',
          note: '',
          savedAt: '2026-08-01T12:00:00.000Z',
        },
      ],
    });

    expect(notifications.map((item) => item.title)).toEqual(['הכנת שכר', 'תוקף דרכון']);
    expect(notifications[0]).toMatchObject({
      severity: 'overdue',
      detail: 'באיחור של 1 ימים',
      to: '/tasks',
    });
  });

  it('ignores completed, paid and distant items', () => {
    const notifications = createCareNotifications({
      today: new Date('2026-08-10T12:00:00'),
      employmentStartDate: '2026-07-01',
      reminderLeadDays: 7,
      documents: [],
      tasks: [
        {
          id: 'completed',
          title: 'הושלם',
          dueDate: '2026-08-10',
          priority: 'normal',
          status: 'completed',
          createdAt: '2026-08-01T12:00:00.000Z',
        },
        {
          id: 'distant',
          title: 'רחוק',
          dueDate: '2026-09-10',
          priority: 'normal',
          status: 'open',
          createdAt: '2026-08-01T12:00:00.000Z',
        },
      ],
      expenses: [
        {
          id: 'paid',
          category: 'שולם',
          frequency: 'annual',
          amount: 100,
          dueDate: '2026-08-10',
          status: 'paid',
          note: '',
          savedAt: '2026-08-01T12:00:00.000Z',
        },
      ],
    });

    expect(notifications).toEqual([]);
  });

  it('alerts for a renewal task according to the selected reminder lead time', () => {
    const input = {
      today: new Date('2026-08-10T12:00:00'),
      employmentStartDate: '2026-07-01',
      documents: [],
      expenses: [],
      tasks: [
        {
          id: 'system-employment-license-renewal',
          title: 'חידוש רישיון ההעסקה',
          dueDate: '2026-08-31',
          priority: 'important' as const,
          status: 'open' as const,
          createdAt: '2026-08-01T12:00:00.000Z',
          source: 'employment-license' as const,
          sourceDate: '2026-08-31',
        },
      ],
    };

    expect(createCareNotifications({ ...input, reminderLeadDays: 14 })).toEqual([]);
    expect(createCareNotifications({ ...input, reminderLeadDays: 21 })).toEqual([
      expect.objectContaining({
        title: 'חידוש רישיון ההעסקה',
        detail: 'נותרו 21 ימים',
        dueDate: '2026-08-31',
        to: '/tasks',
      }),
    ]);
  });

  it('reminds about the monthly salary payment within the reminder lead time', () => {
    const notifications = createCareNotifications({
      today: new Date('2026-09-05T12:00:00'),
      employmentStartDate: '2026-07-01',
      reminderLeadDays: 7,
      documents: [],
      tasks: [],
      expenses: [],
    });

    expect(notifications).toEqual([
      expect.objectContaining({
        title: 'תשלום שכר חודשי — עד ה-9 לחודש',
        detail: 'נותרו 4 ימים',
        severity: 'upcoming',
        dueDate: '2026-09-09',
        to: '/payroll',
      }),
    ]);
  });

  it('keeps the salary reminder silent outside the reminder lead time', () => {
    const notifications = createCareNotifications({
      today: new Date('2026-08-10T12:00:00'),
      employmentStartDate: '2026-07-01',
      reminderLeadDays: 7,
      documents: [],
      tasks: [],
      expenses: [],
    });

    expect(notifications).toEqual([]);
  });

  it('uses the quarterly preparation task on the final day instead of a payment deadline', () => {
    const notifications = createCareNotifications({
      today: new Date('2026-09-30T12:00:00'),
      employmentStartDate: '2026-07-01',
      reminderLeadDays: 7,
      documents: [],
      tasks: [],
      expenses: [],
    });

    expect(notifications).toEqual([
      expect.objectContaining({
        title: 'הכנת נתוני ביטוח לאומי לרבעון יולי – ספטמבר 2026',
        detail: 'יום הכנת הנתונים; התשלום ייפתח מחר',
        dueDate: '2026-09-30',
        to: '/tasks',
      }),
    ]);
  });

  it('raises the quarterly payment task during the October payment window', () => {
    const notifications = createCareNotifications({
      today: new Date('2026-10-10T12:00:00'),
      employmentStartDate: '2026-07-01',
      reminderLeadDays: 7,
      documents: [],
      tasks: [],
      expenses: [],
    });

    expect(notifications).toEqual([
      expect.objectContaining({
        title: 'תשלום ביטוח לאומי לרבעון יולי – ספטמבר 2026',
        detail: 'דורש טיפול · ניתן לשלם בין 1.10 ל־15.10',
        dueDate: '2026-10-15',
        severity: 'attention',
      }),
    ]);
  });

  /**
   * D. The bell followed the tasks card's single quarter, which switched to
   * the next quarter on the 1st of its second month: an unpaid Q3 would have
   * stopped ringing on 01.11.2026, and Q2 had already stopped on 01.08.
   */
  it.each(['2026-10-17', '2026-11-01'])('keeps an unpaid Q3 overdue on %s', (day) => {
    const notifications = createCareNotifications({
      today: new Date(`${day}T12:00:00`),
      employmentStartDate: '2026-07-01',
      reminderLeadDays: 7,
      documents: [],
      tasks: [],
      expenses: [],
    });

    expect(notifications).toEqual([
      expect.objectContaining({
        id: 'national-insurance-2026-q3',
        detail: 'באיחור · מועד אחרון: 15 באוקטובר',
        severity: 'overdue',
        dueDate: '2026-10-15',
      }),
    ]);
  });

  it('keeps older unpaid quarters as one overdue line until they are marked paid', () => {
    const input = {
      today: new Date('2026-10-17T12:00:00'),
      employmentStartDate: '2026-01-15',
      reminderLeadDays: 7 as const,
      documents: [],
      tasks: [],
    };

    expect(createCareNotifications({ ...input, expenses: [] })).toEqual([
      expect.objectContaining({
        title: 'תשלומי ביטוח לאומי לרבעונים קודמים',
        detail: '2 רבעונים קודמים שלא סומנו כשולמו · מועד אחרון: 15 באפריל',
        severity: 'overdue',
        dueDate: '2026-04-15',
      }),
      expect.objectContaining({ id: 'national-insurance-2026-q3', severity: 'overdue' }),
    ]);

    const paid = (sourcePeriod: string) => ({
      id: `expense-${sourcePeriod}`,
      category: 'ביטוח לאומי',
      frequency: 'quarterly' as const,
      amount: 720,
      dueDate: '2026-07-15',
      status: 'paid' as const,
      note: '',
      savedAt: '2026-07-10T12:00:00.000Z',
      sourcePeriod,
    });
    expect(
      createCareNotifications({
        ...input,
        expenses: [paid('2026-Q1'), paid('2026-Q2'), paid('2026-Q3')],
      }),
    ).toEqual([]);
  });
});

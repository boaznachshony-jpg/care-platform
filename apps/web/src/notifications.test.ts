import { describe, expect, it } from 'vitest';
import { createCareNotifications } from './notifications.js';

describe('care notifications', () => {
  it('collects overdue and upcoming items from tasks, documents and expenses', () => {
    const notifications = createCareNotifications({
      today: new Date('2026-08-10T12:00:00'),
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

  it('uses the quarterly preparation task on the final day instead of a payment deadline', () => {
    const notifications = createCareNotifications({
      today: new Date('2026-09-30T12:00:00'),
      reminderLeadDays: 7,
      documents: [],
      tasks: [],
      expenses: [],
    });

    expect(notifications).toEqual([
      expect.objectContaining({
        title: 'הכנת נתוני ביטוח לאומי לרבעון',
        detail: 'יום הכנת הנתונים; התשלום ייפתח מחר',
        dueDate: '2026-09-30',
        to: '/tasks',
      }),
    ]);
  });

  it('raises the quarterly payment task during the October payment window', () => {
    const notifications = createCareNotifications({
      today: new Date('2026-10-10T12:00:00'),
      reminderLeadDays: 7,
      documents: [],
      tasks: [],
      expenses: [],
    });

    expect(notifications).toEqual([
      expect.objectContaining({
        title: 'תשלום ביטוח לאומי לרבעון יולי–ספטמבר',
        detail: 'דורש טיפול · ניתן לשלם בין 1.10 ל־15.10',
        dueDate: '2026-10-15',
        severity: 'attention',
      }),
    ]);
  });
});

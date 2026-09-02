/* eslint-disable no-restricted-syntax */
import type {
  MvpDocument,
  MvpEmploymentExpense,
  MvpTask,
  ReminderLeadDays,
} from './storage/mvp-storage.js';
import { createQuarterlyInsuranceTask } from './quarterly-national-insurance.js';
import { nextSalaryPaymentDate } from './upcoming-payments.js';
import { daysUntil, extractIsoDateFromLabel } from './date-diff.js';

export interface CareNotification {
  id: string;
  title: string;
  detail: string;
  to: '/tasks' | '/documents' | '/payroll';
  severity: 'overdue' | 'attention' | 'upcoming';
  dueDate?: string;
}

export interface CareNotificationInput {
  tasks: MvpTask[];
  documents: MvpDocument[];
  expenses: MvpEmploymentExpense[];
  reminderLeadDays: ReminderLeadDays;
  today?: Date;
}

// Day-difference arithmetic now lives in date-diff.ts (see the comment there
// for why naive `new Date(iso) - Date.now()` subtraction is wrong) - this
// alias keeps the rest of the file, and its tests, unchanged.
function daysFrom(today: Date, value: string): number | null {
  return daysUntil(value, today);
}

// documentExpiry is now the shared extractIsoDateFromLabel (see date-diff.ts)
// so DocumentsPage's badge and this notification list agree on what a
// document's expiry date is.
const documentExpiry = extractIsoDateFromLabel;

function timing(days: number): Pick<CareNotification, 'severity' | 'detail'> {
  if (days < 0) {
    return {
      severity: 'overdue',
      detail: `באיחור של ${Math.abs(days)} ימים`,
    };
  }
  if (days === 0) return { severity: 'attention', detail: 'המועד הוא היום' };
  return { severity: 'upcoming', detail: `נותרו ${days} ימים` };
}

export function createCareNotifications({
  tasks,
  documents,
  expenses,
  reminderLeadDays,
  today = new Date(),
}: CareNotificationInput): CareNotification[] {
  const items: CareNotification[] = [];

  for (const task of tasks) {
    if (task.status !== 'open') continue;
    const days = daysFrom(today, task.dueDate);
    if (days === null || days > reminderLeadDays) continue;
    items.push({
      id: `task-${task.id}`,
      title: task.title,
      to: '/tasks',
      dueDate: task.dueDate,
      ...timing(days),
    });
  }

  for (const document of documents) {
    const expiry = documentExpiry(document.dateLabel);
    const days = expiry ? daysFrom(today, expiry) : null;
    if (document.status === 'attention') {
      items.push({
        id: `document-${document.id}`,
        title: `${document.name} דורש טיפול`,
        detail: days === null ? 'המסמך סומן לבדיקה' : timing(days).detail,
        severity: days !== null && days < 0 ? 'overdue' : 'attention',
        to: '/documents',
        dueDate: expiry ?? undefined,
      });
    } else if (days !== null && days <= reminderLeadDays) {
      items.push({
        id: `document-${document.id}`,
        title: `תוקף ${document.name}`,
        to: '/documents',
        dueDate: expiry ?? undefined,
        ...timing(days),
      });
    }
  }

  for (const expense of expenses) {
    if (expense.status === 'paid') continue;
    if (expense.category === 'ביטוח לאומי' && expense.frequency === 'quarterly') continue;
    const days = daysFrom(today, expense.dueDate);
    if (days === null || days > reminderLeadDays) continue;
    items.push({
      id: `expense-${expense.id}`,
      title: expense.category,
      to: '/payroll',
      dueDate: expense.dueDate,
      ...timing(days),
    });
  }

  const salaryDueDate = nextSalaryPaymentDate(today);
  const salaryDays = daysFrom(today, salaryDueDate);
  if (salaryDays !== null && salaryDays <= reminderLeadDays) {
    items.push({
      id: `salary-payment-${salaryDueDate}`,
      title: 'תשלום שכר חודשי — עד ה-9 לחודש',
      to: '/payroll',
      dueDate: salaryDueDate,
      ...timing(salaryDays),
    });
  }

  const quarterlyInsurance = createQuarterlyInsuranceTask(today);
  if (quarterlyInsurance.preparationOnly) {
    items.push({
      id: quarterlyInsurance.id,
      title: quarterlyInsurance.title,
      detail: 'יום הכנת הנתונים; התשלום ייפתח מחר',
      severity: 'attention',
      to: '/tasks',
      dueDate: quarterlyInsurance.periodEnd,
    });
  } else if (quarterlyInsurance.status !== 'not_open') {
    items.push({
      id: quarterlyInsurance.id,
      title: quarterlyInsurance.title,
      detail:
        quarterlyInsurance.status === 'overdue'
          ? `${quarterlyInsurance.statusLabel} · ${quarterlyInsurance.deadlineLabel}`
          : `${quarterlyInsurance.statusLabel} · ${quarterlyInsurance.paymentWindow}`,
      severity:
        quarterlyInsurance.status === 'overdue'
          ? 'overdue'
          : quarterlyInsurance.status === 'open'
            ? 'upcoming'
            : 'attention',
      to: '/tasks',
      dueDate: quarterlyInsurance.deadlineDate,
    });
  }

  const severityOrder = { overdue: 0, attention: 1, upcoming: 2 };
  return items.sort(
    (first, second) =>
      severityOrder[first.severity] - severityOrder[second.severity] ||
      (first.dueDate ?? '').localeCompare(second.dueDate ?? ''),
  );
}

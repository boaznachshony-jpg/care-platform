import { describe, expect, it } from 'vitest';
import { createQuarterlyInsuranceTask } from './quarterly-national-insurance.js';

function on(value: string) {
  return createQuarterlyInsuranceTask(new Date(`${value}T12:00:00`));
}

describe('quarterly national insurance task', () => {
  it('uses the last day of the quarter for preparation only', () => {
    const task = on('2026-09-30');
    expect(task).toMatchObject({
      title: 'הכנת נתוני ביטוח לאומי לרבעון',
      periodRange: 'תקופת דיווח: 1.7–30.9',
      paymentOpenDate: '2026-10-01',
      deadlineDate: '2026-10-15',
      preparationOnly: true,
      statusLabel: 'טרם נפתח לתשלום',
    });
  });

  it.each([
    ['2026-09-29', 'טרם נפתח לתשלום'],
    ['2026-10-01', 'פתוח לתשלום'],
    ['2026-10-09', 'פתוח לתשלום'],
    ['2026-10-10', 'דורש טיפול'],
    ['2026-10-14', 'דורש טיפול'],
    ['2026-10-15', 'מועד אחרון היום'],
    ['2026-10-16', 'באיחור'],
  ])('returns the correct status on %s', (date, statusLabel) => {
    expect(on(date).statusLabel).toBe(statusLabel);
  });

  it('describes the third-quarter payment card without using September 30 as payment date', () => {
    const task = on('2026-10-01');
    expect(task).toMatchObject({
      title: 'תשלום ביטוח לאומי לרבעון יולי–ספטמבר',
      paymentWindow: 'ניתן לשלם בין 1.10 ל־15.10',
      deadlineLabel: 'מועד אחרון: 15 באוקטובר',
    });
    expect(task.deadlineDate).not.toBe('2026-09-30');
  });
});

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TimelinePage } from './TimelinePage.js';

function renderTimeline(today: Date, employmentStartDate = '2026-07-12') {
  render(
    <MemoryRouter>
      <TimelinePage today={today} employmentStartDate={employmentStartDate} />
    </MemoryRouter>,
  );
}

describe('TimelinePage', () => {
  it('starts employment-dependent events on the employment start date', () => {
    renderTimeline(new Date('2026-08-02T12:00:00'));

    expect(screen.getByText('12 יולי')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'בדיקת ביטוח רפואי' })).toBeVisible();
    expect(screen.getByText('החל ממועד תחילת ההעסקה')).toBeVisible();
    expect(screen.queryByText('03 אוג׳')).not.toBeInTheDocument();
  });

  it('shows preparation rather than payment on the final day of the quarter', () => {
    renderTimeline(new Date('2026-09-30T12:00:00'));

    expect(screen.getByText('30 ספט׳')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'הכנת נתוני ביטוח לאומי לרבעון' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: /תשלום ביטוח לאומי/ })).not.toBeInTheDocument();
  });

  it('shows the October 15 deadline after payment opens', () => {
    renderTimeline(new Date('2026-10-10T12:00:00'));

    expect(screen.getByText('15 אוק׳')).toBeVisible();
    expect(
      screen.getByRole('heading', {
        name: 'תשלום ביטוח לאומי לרבעון יולי – ספטמבר',
      }),
    ).toBeVisible();
    expect(screen.getByText('ניתן לשלם בין 1.10 ל־15.10 · דורש טיפול')).toBeVisible();
  });

  it('links every details action to the relevant workflow', () => {
    renderTimeline(new Date('2026-10-10T12:00:00'));

    expect(
      screen.getAllByRole('link', { name: 'פרטים' }).map((link) => link.getAttribute('href')),
    ).toEqual(['/documents', '/payroll', '/tasks', '/app', '/tasks']);
  });
});

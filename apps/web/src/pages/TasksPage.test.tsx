import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { readMvpTasks } from '../storage/mvp-storage.js';
import { TasksPage } from './TasksPage.js';

describe('TasksPage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates and persists a new task from the primary action', () => {
    render(<TasksPage />);

    fireEvent.click(screen.getByRole('button', { name: /משימה חדשה/ }));
    fireEvent.change(screen.getByLabelText('מה צריך לבצע?'), {
      target: { value: 'חידוש ביטוח רפואי' },
    });
    fireEvent.change(screen.getByLabelText('מועד יעד'), {
      target: { value: '2026-08-15' },
    });
    fireEvent.change(screen.getByLabelText('עדיפות'), {
      target: { value: 'important' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת המשימה' }));

    expect(screen.getByText('חידוש ביטוח רפואי')).toBeVisible();
    expect(readMvpTasks()).toEqual([
      expect.objectContaining({
        title: 'חידוש ביטוח רפואי',
        dueDate: '2026-08-15',
        priority: 'important',
        status: 'open',
      }),
    ]);
  });

  it('moves a completed task to the completed filter', () => {
    render(<TasksPage />);
    fireEvent.click(screen.getByRole('button', { name: /משימה חדשה/ }));
    fireEvent.change(screen.getByLabelText('מה צריך לבצע?'), {
      target: { value: 'הגשת דיווח' },
    });
    fireEvent.change(screen.getByLabelText('מועד יעד'), {
      target: { value: '2026-08-20' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת המשימה' }));
    fireEvent.click(screen.getByRole('button', { name: 'השלמת הגשת דיווח' }));

    expect(screen.queryByText('הגשת דיווח')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'הושלמו' }));
    expect(screen.getByText('הגשת דיווח')).toBeVisible();
  });

  it('shows preparation only on the final day of the quarter', () => {
    render(<TasksPage today={new Date('2026-09-30T12:00:00')} />);

    expect(screen.getByRole('heading', { name: 'הכנת נתוני ביטוח לאומי לרבעון' })).toBeVisible();
    expect(screen.getByText('טרם נפתח לתשלום')).toBeVisible();
    expect(screen.getByText(/אפשרות הדיווח והתשלום תיפתח מחר/)).toBeVisible();
  });

  it('shows the complete third-quarter payment card after payment opens', () => {
    render(<TasksPage today={new Date('2026-10-10T12:00:00')} />);

    expect(
      screen.getByRole('heading', {
        name: 'תשלום ביטוח לאומי לרבעון יולי–ספטמבר',
      }),
    ).toBeVisible();
    expect(screen.getByText('ניתן לשלם בין 1.10 ל־15.10')).toBeVisible();
    expect(screen.getByText('מועד אחרון: 15 באוקטובר')).toBeVisible();
    expect(screen.getByText('דורש טיפול')).toBeVisible();
    expect(screen.queryByText(/30.9.*מועד אחרון/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'מעבר לאתר הביטוח הלאומי לדיווח ולתשלום' }),
    ).toHaveAttribute('href', 'https://b2b.btl.gov.il/BTL.ILG.Payments/MeshekBaitInfoShort.aspx');
  });
});

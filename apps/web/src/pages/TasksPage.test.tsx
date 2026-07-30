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
});

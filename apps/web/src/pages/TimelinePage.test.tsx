import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TimelinePage } from './TimelinePage.js';

describe('TimelinePage product-intelligence projection', () => {
  it('does not fabricate deadlines when the case has no persisted facts', () => {
    render(
      <MemoryRouter>
        <TimelinePage today={new Date('2026-08-15T12:00:00Z')} />
      </MemoryRouter>,
    );
    expect(screen.getByText('אין כרגע מועדים פתוחים להצגה.')).toBeVisible();
    expect(screen.queryByText('הכנת שכר יולי')).not.toBeInTheDocument();
  });

  it('explains that entries come only from stored case data', () => {
    render(
      <MemoryRouter>
        <TimelinePage today={new Date('2026-08-15T12:00:00Z')} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/מועדים שנגזרו רק ממשימות ומנתונים שנשמרו בתיק/)).toBeVisible();
  });
});

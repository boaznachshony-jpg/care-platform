import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TimelinePage } from './TimelinePage.js';

describe('TimelinePage', () => {
  it('shows the internal treatment date and the official third-quarter deadline', () => {
    render(<TimelinePage />);

    expect(screen.getByText('15 אוק׳')).toBeVisible();
    expect(screen.getByText('מועד טיפול פנימי עבור יולי–ספטמבר · המועד הרשמי 20.10')).toBeVisible();
    expect(screen.queryByText('30 ספט׳')).not.toBeInTheDocument();
  });
});

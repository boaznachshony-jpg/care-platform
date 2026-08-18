import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { Skeleton } from './Skeleton.js';

describe('Skeleton', () => {
  it('exposes exactly one polite announcement, not a decorative box read aloud', () => {
    render(<Skeleton loadingLabel="טוען משימות" />);
    expect(screen.getByRole('status')).toHaveTextContent('טוען משימות');
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(
      <Skeleton loadingLabel="Loading tasks" shape="circle" width="2rem" height="2rem" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

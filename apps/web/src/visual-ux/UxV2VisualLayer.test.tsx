import { StrictMode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UxV2VisualLayer } from './UxV2VisualLayer.js';

function RoutesHarness() {
  const navigate = useNavigate();
  return (
    <>
      <UxV2VisualLayer />
      <button onClick={() => navigate('/clients/family-1/tasks')}>tasks</button>
      <button onClick={() => navigate('/clients/family-1/medications')}>medications</button>
      <button onClick={() => navigate('/clients/family-1/payroll')}>payroll</button>
    </>
  );
}

beforeEach(() => {
  vi.stubEnv('MODE', 'ux-v2-test');
  document.documentElement.classList.add('existing-preference');
  document.documentElement.setAttribute('data-theme', 'dark');
  document.documentElement.style.setProperty('--ui-scale', '1.3');
});

afterEach(() => {
  vi.unstubAllEnvs();
  document.documentElement.classList.remove('ux-v2-visual', 'existing-preference');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.removeProperty('--ui-scale');
});

describe('visual layer lifecycle', () => {
  it('adds no DOM and preserves existing theme, text scale and HTML classes', () => {
    const { container, unmount } = render(
      <MemoryRouter initialEntries={['/tasks']}>
        <UxV2VisualLayer />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(document.documentElement).toHaveClass('ux-v2-visual', 'existing-preference');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.3');
    unmount();
    expect(document.documentElement).not.toHaveClass('ux-v2-visual');
    expect(document.documentElement).toHaveClass('existing-preference');
  });

  it('removes styling on an excluded route and restores it on the next target without remounting the router', () => {
    render(
      <MemoryRouter initialEntries={['/clients/family-1']}>
        <RoutesHarness />
      </MemoryRouter>,
    );
    expect(document.documentElement).toHaveClass('ux-v2-visual');
    fireEvent.click(screen.getByRole('button', { name: 'payroll' }));
    expect(document.documentElement).not.toHaveClass('ux-v2-visual');
    fireEvent.click(screen.getByRole('button', { name: 'medications' }));
    expect(document.documentElement).toHaveClass('ux-v2-visual');
    fireEvent.click(screen.getByRole('button', { name: 'tasks' }));
    expect(document.documentElement).toHaveClass('ux-v2-visual');
  });

  it.each(['test', 'development', 'production'])(
    'leaves the default %s build unchanged',
    (mode) => {
      vi.stubEnv('MODE', mode);
      render(
        <MemoryRouter initialEntries={['/tasks']}>
          <UxV2VisualLayer />
        </MemoryRouter>,
      );
      expect(document.documentElement).not.toHaveClass('ux-v2-visual');
    },
  );

  it('does not leak the class after a StrictMode mount and cleanup cycle', () => {
    const view = render(
      <StrictMode>
        <MemoryRouter initialEntries={['/app']}>
          <UxV2VisualLayer />
        </MemoryRouter>
      </StrictMode>,
    );
    expect(document.documentElement).toHaveClass('ux-v2-visual');
    view.unmount();
    expect(document.documentElement).not.toHaveClass('ux-v2-visual');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });
});

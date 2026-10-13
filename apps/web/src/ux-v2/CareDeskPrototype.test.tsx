import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { CareDeskPrototype } from './CareDeskPrototype.js';

afterEach(() => vi.restoreAllMocks());

describe('isolated CareDesk UX V2', () => {
  it('completes and restores a medication purchase without network or storage writes', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');
    render(<CareDeskPrototype />);
    fireEvent.click(screen.getByRole('button', { name: 'לרשימת הרכישות' }));
    fireEvent.click(screen.getByRole('button', { name: 'סימון כנרכש: איסוף הזמנה מבית המרקחת' }));
    expect(
      screen.queryByRole('heading', { name: 'איסוף הזמנה מבית המרקחת' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'הושלמו' }));
    fireEvent.click(screen.getByRole('button', { name: 'החזרה לפתוחות: איסוף הזמנה מבית המרקחת' }));
    fireEvent.click(screen.getByRole('button', { name: 'פתוחות' }));
    expect(screen.getByRole('heading', { name: 'איסוף הזמנה מבית המרקחת' })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it('validates new tasks, retains input and restores focus', () => {
    render(<CareDeskPrototype />);
    const add = screen.getByRole('button', { name: '+ משימה חדשה' });
    fireEvent.click(add);
    const title = screen.getByLabelText('מה צריך לעשות?');
    expect(title).toHaveFocus();
    fireEvent.change(title, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספת משימה' }));
    expect(screen.getByRole('alert')).toHaveTextContent('יש להזין תיאור משימה');
    fireEvent.change(title, { target: { value: 'לבדוק את רשימת הקניות' } });
    fireEvent.change(screen.getByLabelText('מי מטפל?'), { target: { value: 'אורי' } });
    expect(title).toHaveValue('לבדוק את רשימת הקניות');
    fireEvent.click(screen.getByRole('button', { name: 'הוספת משימה' }));
    expect(screen.getByRole('heading', { name: 'לבדוק את רשימת הקניות' })).toBeInTheDocument();
    expect(add).toHaveFocus();
  });

  it('requires a reason for postponement and keeps the item visible for tomorrow', () => {
    render(<CareDeskPrototype />);
    const card = screen
      .getByRole('heading', { name: 'לתאם את יום החופש השבועי' })
      .closest('article')!;
    fireEvent.click(within(card).getByRole('button', { name: 'דחייה למחר' }));
    fireEvent.click(within(card).getByRole('button', { name: 'שמירת הדחייה' }));
    expect(within(card).getByRole('alert')).toBeInTheDocument();
    fireEvent.change(within(card).getByLabelText('סיבת הדחייה'), {
      target: { value: 'ממתינים לתיאום משפחתי' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'שמירת הדחייה' }));
    expect(within(card).getByText('נדחה למחר')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'דחייה למחר' })).toHaveFocus();
  });

  it('filters by category and search and handles an empty result', () => {
    render(<CareDeskPrototype />);
    fireEvent.click(
      within(screen.getByRole('navigation')).getByRole('button', { name: /חובות ומועדים/ }),
    );
    expect(screen.queryByRole('button', { name: /סימון כנרכש/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'אין התאמה' } });
    expect(screen.getByRole('heading', { name: 'הרשימה נקייה.' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ניקוי סינון' }));
    expect(
      screen.getByRole('button', { name: 'סימון כהושלם: ריכוז אסמכתאות החודש' }),
    ).toBeInTheDocument();
  });

  it('resets synthetic state on remount', () => {
    const first = render(<CareDeskPrototype />);
    fireEvent.click(screen.getByRole('button', { name: 'סימון כנרכש: איסוף הזמנה מבית המרקחת' }));
    first.unmount();
    render(<CareDeskPrototype />);
    expect(
      screen.getByRole('button', { name: 'סימון כנרכש: איסוף הזמנה מבית המרקחת' }),
    ).toBeInTheDocument();
  });

  it('has no automated accessibility violations in the default and form states', async () => {
    const { container } = render(<CareDeskPrototype />);
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole('button', { name: '+ משימה חדשה' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});

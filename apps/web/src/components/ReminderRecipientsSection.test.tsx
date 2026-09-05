import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { ReminderRecipientsSection } from './ReminderRecipientsSection.js';

const NOT_YET_DELIVERED =
  'שליחת תזכורות לנמענים עדיין לא פעילה בגרסה זו. הפרטים שתירשמו כאן לא ישמשו למשלוח עד שתופיע כאן הודעה אחרת.';

function renderSection() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <ReminderRecipientsSection recordedBy="בעל החשבון" />
    </I18nextProvider>,
  );
}

/**
 * GAP-3-01: the screen promised delivery to named people while no code sends
 * any reminder. The form stays (the owner may prepare the list), but the copy
 * must not promise a send anywhere.
 */
describe('ReminderRecipientsSection honesty about delivery', () => {
  beforeEach(() => localStorage.clear());

  it('says first that delivery is not active in this version', () => {
    renderSection();
    const section = screen.getByRole('region', { name: 'מי מקבל תזכורות' });
    const firstParagraph = section.querySelector('p');
    expect(firstParagraph).toHaveTextContent(NOT_YET_DELIVERED);
    expect(firstParagraph).toHaveAttribute('role', 'status');
  });

  it('describes the empty list without promising that adding someone triggers a send', () => {
    renderSection();
    expect(screen.getByText(/עדיין לא נרשמו נמענים/)).toHaveTextContent(/כשהמשלוח יופעל/);
  });

  it('marks a consenting recipient as ready only once delivery is switched on', () => {
    renderSection();
    fireEvent.change(screen.getByLabelText('שם'), { target: { value: 'רות כהן' } });
    fireEvent.change(screen.getByLabelText('טלפון'), { target: { value: '+972501234567' } });
    fireEvent.click(screen.getByLabelText('הנמען אישר לקבל תזכורות'));
    fireEvent.click(screen.getByRole('button', { name: 'הוספת נמען' }));

    expect(screen.getByText('יקבל תזכורות כשהמשלוח יופעל')).toBeInTheDocument();
    expect(screen.queryByText(/^יקבל תזכורות$/)).not.toBeInTheDocument();
  });
});

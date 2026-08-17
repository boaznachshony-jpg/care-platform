import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { AutomationPanel } from './AutomationPanel.js';

const DEMO_CASE_ID = 'case-demo-001';

const mockConfirm = vi.fn().mockResolvedValue(undefined);
vi.mock('../../api/client.js', () => ({
  confirmAssistantChecklist: (...args: unknown[]) => mockConfirm(...args),
}));

function renderPanel(caseId = DEMO_CASE_ID) {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <AutomationPanel caseId={caseId} />
    </I18nextProvider>,
  );
}

describe('AutomationPanel', () => {
  it('renders the home view with two primary action buttons', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'משהו השתנה' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'מה לבדוק לפני נסיעה?' })).toBeInTheDocument();
  });

  it('navigates to the event list when "משהו השתנה" is clicked', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'משהו השתנה' }));
    expect(
      screen.getByRole('button', { name: 'המטפל/ת מתכננ/ת חופשה או נסיעה' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'המטפל/ת התפטר/ה' })).toBeInTheDocument();
  });

  it('returns to home from the events list', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'משהו השתנה' }));
    fireEvent.click(screen.getByRole('button', { name: 'חזרה' }));
    expect(screen.getByRole('button', { name: 'משהו השתנה' })).toBeInTheDocument();
  });

  it('shows travel date form and plan button is disabled until dates are valid', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'משהו השתנה' }));
    fireEvent.click(screen.getByRole('button', { name: 'המטפל/ת מתכננ/ת חופשה או נסיעה' }));
    expect(screen.getByRole('button', { name: 'יצירת תוכנית לבדיקה' })).toBeDisabled();
  });

  it('calls confirmAssistantChecklist with the caseId when plan is confirmed', async () => {
    mockConfirm.mockClear();
    renderPanel(DEMO_CASE_ID);

    fireEvent.click(screen.getByRole('button', { name: 'משהו השתנה' }));
    fireEvent.click(screen.getByRole('button', { name: 'המטפל/ת התפטר/ה' }));
    fireEvent.click(screen.getByRole('button', { name: 'אישור ויצירת משימות' }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledOnce());
    const [calledCaseId, calledItems] = mockConfirm.mock.calls[0] as [string, string[]];
    expect(calledCaseId).toBe(DEMO_CASE_ID);
    expect(Array.isArray(calledItems)).toBe(true);
    expect(calledItems.length).toBeGreaterThan(0);
  });

  it('shows success status after plan is saved', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'משהו השתנה' }));
    fireEvent.click(screen.getByRole('button', { name: 'המטפל/ת התפטר/ה' }));
    fireEvent.click(screen.getByRole('button', { name: 'אישור ויצירת משימות' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('התוכנית נשמרה בהצלחה.'),
    );
  });
});

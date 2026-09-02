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

// The key generator is a separate module now, so a suite that mocks the API
// surface still gets the real fallback logic the retry tests depend on.
vi.unmock('../../api/idempotency.js');

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

  // Defect 4(a): a one-day trip (departure === return) is legitimate travel
  // and must not be rejected as an ordering error.
  it('allows a same-day departure and return date', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'משהו השתנה' }));
    fireEvent.click(screen.getByRole('button', { name: 'המטפל/ת מתכננ/ת חופשה או נסיעה' }));
    fireEvent.change(screen.getByLabelText('תאריך יציאה'), { target: { value: '2026-09-10' } });
    fireEvent.change(screen.getByLabelText('תאריך חזרה'), { target: { value: '2026-09-10' } });
    expect(screen.getByRole('button', { name: 'יצירת תוכנית לבדיקה' })).not.toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // Defect 4(b): a departure date far in the past must warn, not block.
  it('warns (without blocking) on a departure date far in the past', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'משהו השתנה' }));
    fireEvent.click(screen.getByRole('button', { name: 'המטפל/ת מתכננ/ת חופשה או נסיעה' }));
    fireEvent.change(screen.getByLabelText('תאריך יציאה'), { target: { value: '2020-01-01' } });
    fireEvent.change(screen.getByLabelText('תאריך חזרה'), { target: { value: '2020-01-05' } });
    expect(screen.getByText(/תאריך היציאה רחוק בעבר/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'יצירת תוכנית לבדיקה' })).not.toBeDisabled();
  });

  // Defect 4(c): the on-screen plan and the saved payload must come from the
  // same array, so a travel plan's on-screen items include the trip dates,
  // exactly like what gets sent to the server.
  it('shows the same travel-dated items on screen that get saved', async () => {
    mockConfirm.mockClear();
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'משהו השתנה' }));
    fireEvent.click(screen.getByRole('button', { name: 'המטפל/ת מתכננ/ת חופשה או נסיעה' }));
    fireEvent.change(screen.getByLabelText('תאריך יציאה'), { target: { value: '2026-09-10' } });
    fireEvent.change(screen.getByLabelText('תאריך חזרה'), { target: { value: '2026-09-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'יצירת תוכנית לבדיקה' }));

    expect(screen.getByText(/2026-09-10–2026-09-15/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'אישור ויצירת משימות' }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledOnce());
    const [, calledItems] = mockConfirm.mock.calls[0] as [string, string[]];
    expect(calledItems.every((item) => item.includes('2026-09-10–2026-09-15'))).toBe(true);
  });

  // Defect 4(d): the "no approved rule" message must not talk about a
  // missing travel rule for an event that has nothing to do with travel.
  it('shows event-appropriate wording instead of the travel-rule sentence for a death event', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'משהו השתנה' }));
    fireEvent.click(screen.getByRole('button', { name: 'מקבל/ת הטיפול נפטר/ה' }));
    expect(screen.queryByText(/כלל נסיעה מאושר/)).not.toBeInTheDocument();
    expect(screen.getByText(/מקרה פטירה/)).toBeInTheDocument();
  });

  // Defect 1/2: retrying the same confirmed plan after a failure must reuse
  // the same idempotency key, not mint a new one that would let the server
  // create a duplicate confirmation.
  it('reuses the same idempotency key when retrying after a failed confirm', async () => {
    mockConfirm.mockClear();
    mockConfirm.mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(undefined);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'משהו השתנה' }));
    fireEvent.click(screen.getByRole('button', { name: 'המטפל/ת התפטר/ה' }));
    fireEvent.click(screen.getByRole('button', { name: 'אישור ויצירת משימות' }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('שמירת התוכנית נכשלה. נסו שוב.'),
    );

    // The user presses the same button again after the failure, with the
    // same underlying plan (nothing was re-entered).
    fireEvent.click(screen.getByRole('button', { name: 'אישור ויצירת משימות' }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(2));

    const [, , firstKey] = mockConfirm.mock.calls[0] as [string, string[], string];
    const [, , secondKey] = mockConfirm.mock.calls[1] as [string, string[], string];
    expect(secondKey).toBe(firstKey);
  });
});

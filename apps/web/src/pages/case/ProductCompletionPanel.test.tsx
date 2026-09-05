import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { ProductCompletionPanel } from './ProductCompletionPanel.js';

// Constitution §16: synthetic data only.
const DEMO_CASE_ID = 'case-demo-001';

const mockGetCaseHealth = vi.fn();
const mockListProfessionalReviews = vi.fn();
const mockAskCaseAssistant = vi.fn();
const mockConfirmAssistantChecklist = vi.fn();
const mockCreateProfessionalReview = vi.fn();
const mockGetProfessionalReview = vi.fn();
const mockTransitionProfessionalReview = vi.fn();

vi.mock('../../api/client.js', () => ({
  getCaseHealth: (...args: unknown[]) => mockGetCaseHealth(...args),
  listProfessionalReviews: (...args: unknown[]) => mockListProfessionalReviews(...args),
  askCaseAssistant: (...args: unknown[]) => mockAskCaseAssistant(...args),
  confirmAssistantChecklist: (...args: unknown[]) => mockConfirmAssistantChecklist(...args),
  createProfessionalReview: (...args: unknown[]) => mockCreateProfessionalReview(...args),
  getProfessionalReview: (...args: unknown[]) => mockGetProfessionalReview(...args),
  transitionProfessionalReview: (...args: unknown[]) => mockTransitionProfessionalReview(...args),
}));

const DEMO_HEALTH = {
  score: 82,
  actionsRemaining: 3,
  factors: [
    {
      id: 'factor-001',
      title: 'תאריך חידוש אשרה',
      explanation: 'מועד חידוש האשרה מוגדר',
      status: 'good',
      points: 10,
      weight: 10,
      actionTarget: null,
      recommendedAction: null,
      provenance: { sourceType: 'profile', sourceIds: [] },
    },
  ],
};

// A single instance also resolves escalation.* keys for assertions, so the
// tests keep passing once the pending i18n resources are merged.
const i18n = initI18n();
const tt = (key: string) => i18n.t(key) as string;

const REQUESTED_REVIEW = {
  id: 'rev-100',
  category: 'general',
  reason: 'סיבת בדיקה סינתטית',
  summary: 'תקציר סינתטי',
  source: 'manual',
  status: 'requested',
  assignedTo: null,
  resolutionNote: null,
  resolvedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
};

function renderPanel(caseId = DEMO_CASE_ID) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ProductCompletionPanel caseId={caseId} />
    </I18nextProvider>,
  );
}

describe('ProductCompletionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCaseHealth.mockResolvedValue(DEMO_HEALTH);
    mockListProfessionalReviews.mockResolvedValue([]);
    mockAskCaseAssistant.mockResolvedValue(null);
    mockConfirmAssistantChecklist.mockResolvedValue(undefined);
    mockCreateProfessionalReview.mockResolvedValue({
      id: 'rev-001',
      status: 'requested',
      reason: '',
    });
    mockGetProfessionalReview.mockResolvedValue({ review: REQUESTED_REVIEW, history: [] });
    mockTransitionProfessionalReview.mockResolvedValue({
      ...REQUESTED_REVIEW,
      status: 'acknowledged',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the case health heading', async () => {
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'מצב תיק ההעסקה' })).toBeInTheDocument(),
    );
  });

  it('shows the health score after loading', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('82')).toBeInTheDocument());
  });

  it('announces the loading state with role=status until the health promise resolves', () => {
    mockGetCaseHealth.mockReturnValue(new Promise(() => undefined));
    renderPanel();
    expect(screen.getByRole('status')).toHaveTextContent(tt('shell.loading'));
  });

  it('shows the AI assistant section', async () => {
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'העוזר של התיק הזה' })).toBeInTheDocument(),
    );
  });

  it('ask button is disabled when question is too short', async () => {
    renderPanel();
    await waitFor(() => screen.getByRole('heading', { name: 'מצב תיק ההעסקה' }));
    expect(screen.getByRole('button', { name: 'בדיקה לפי תיק CareDesk' })).toBeDisabled();
  });

  it('shows no reviews message when reviews list is empty', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('אין בקשות בדיקה פתוחות.')).toBeInTheDocument());
  });

  it('calls getCaseHealth and listProfessionalReviews on mount', async () => {
    renderPanel();
    await waitFor(() => expect(mockGetCaseHealth).toHaveBeenCalledWith(DEMO_CASE_ID));
    expect(mockListProfessionalReviews).toHaveBeenCalledWith(DEMO_CASE_ID);
  });

  describe('assistant answer translation', () => {
    const ASSISTANT_RESPONSE = {
      answer: 'Your CareDesk file is missing valid evidence for: passport, visa.',
      answerId: 'assistant.answer.missingDocuments',
      answerParams: { missingTypes: ['passport', 'visa'] },
      groundingLabel: 'Based on your CareDesk file',
      groundingLabelId: 'assistant.groundingLabel',
      factsUsed: [
        {
          factPath: 'caseSummary.status',
          label: 'Case status: active',
          labelId: 'assistant.fact.caseStatus',
          labelParams: { status: 'active' },
        },
      ],
      uncertainties: [{ code: 'no_approved_rule', message: 'No approved rule was available.' }],
      recommendedActions: [],
      escalation: {
        required: true,
        reason: 'No approved rule covers professional interpretation',
        reasonId: 'assistant.escalation.reasonNoRule',
      },
    };

    async function askAndGetArticle() {
      renderPanel();
      await waitFor(() => screen.getByRole('heading', { name: 'מצב תיק ההעסקה' }));
      fireEvent.change(screen.getByLabelText('מה תרצו לבדוק?'), {
        target: { value: 'מה חסר בתיק?' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'בדיקה לפי תיק CareDesk' }));
      return waitFor(() => screen.getByRole('article', { name: 'תשובה לתיק בסיוע AI' }));
    }

    it('renders the answer, grounding label, fact and uncertainty in Hebrew via their ids', async () => {
      mockAskCaseAssistant.mockResolvedValue(ASSISTANT_RESPONSE);
      await askAndGetArticle();
      expect(screen.getByText('בהתבסס על תיק ה-CareDesk שלכם')).toBeInTheDocument();
      expect(
        screen.getByText('בתיק ה-CareDesk שלכם חסרות ראיות בתוקף עבור: דרכון, אשרה והיתר עבודה.'),
      ).toBeInTheDocument();
      expect(screen.getByText('סטטוס התיק: פעיל')).toBeInTheDocument();
      expect(screen.getByText('לא נמצא כלל מאושר לפרשנות מקצועית.')).toBeInTheDocument();
      expect(screen.queryByText(ASSISTANT_RESPONSE.answer)).not.toBeInTheDocument();
    });

    it('falls back to the server English text when an id is not recognised', async () => {
      mockAskCaseAssistant.mockResolvedValue({
        ...ASSISTANT_RESPONSE,
        answerId: 'assistant.answer.somethingNew',
      });
      await askAndGetArticle();
      expect(
        screen.getByText('Your CareDesk file is missing valid evidence for: passport, visa.'),
      ).toBeInTheDocument();
    });

    it('sends the translated escalation reason when creating a review from an answer', async () => {
      mockAskCaseAssistant.mockResolvedValue(ASSISTANT_RESPONSE);
      await askAndGetArticle();
      fireEvent.click(screen.getByRole('button', { name: 'יצירת בקשת בדיקה' }));
      await waitFor(() =>
        expect(mockCreateProfessionalReview).toHaveBeenCalledWith(
          DEMO_CASE_ID,
          expect.objectContaining({ reason: 'לא נמצא כלל מאושר לפרשנות מקצועית' }),
          expect.any(String),
        ),
      );
    });
  });

  /**
   * UI-WRITE-03 / UI-STATES-08. "Create tasks" was `void confirmAssistantChecklist(...)`
   * straight from onClick: no await, no catch, no lock, a fresh idempotency key
   * per click. Every press created the checklist's tasks again on the server and
   * a failure looked exactly like success. The question itself had no failure
   * state either.
   */
  describe('assistant write contract', () => {
    const CHECKLIST_RESPONSE = {
      answer: 'Here is what to do next.',
      groundingLabel: 'Based on your CareDesk file',
      factsUsed: [],
      uncertainties: [],
      recommendedActions: [],
      proposedChecklist: ['לחדש את האשרה', 'להעלות דרכון'],
      escalation: { required: false, reason: '' },
    };

    async function askForChecklist() {
      renderPanel();
      await waitFor(() => screen.getByRole('heading', { name: 'מצב תיק ההעסקה' }));
      fireEvent.change(screen.getByLabelText('מה תרצו לבדוק?'), {
        target: { value: 'מה חסר בתיק?' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'בדיקה לפי תיק CareDesk' }));
      return screen.findByRole('button', { name: tt('completion.createTasks') });
    }

    it('shows an alert when the assistant question fails', async () => {
      mockAskCaseAssistant.mockRejectedValue(new Error('assistant down'));
      renderPanel();
      await waitFor(() => screen.getByRole('heading', { name: 'מצב תיק ההעסקה' }));
      fireEvent.change(screen.getByLabelText('מה תרצו לבדוק?'), {
        target: { value: 'מה חסר בתיק?' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'בדיקה לפי תיק CareDesk' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(tt('completion.askFailed'));
      // The question is kept and the button is usable again for a retry.
      expect(screen.getByLabelText('מה תרצו לבדוק?')).toHaveValue('מה חסר בתיק?');
      expect(screen.getByRole('button', { name: 'בדיקה לפי תיק CareDesk' })).toBeEnabled();
    });

    it('calls the confirmation API once for two clicks while it is pending, then reports saved', async () => {
      mockAskCaseAssistant.mockResolvedValue(CHECKLIST_RESPONSE);
      let resolveConfirm: (() => void) | undefined;
      mockConfirmAssistantChecklist.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
      );
      const button = await askForChecklist();
      fireEvent.click(button);
      fireEvent.click(button);
      await waitFor(() => expect(mockConfirmAssistantChecklist).toHaveBeenCalledTimes(1));
      expect(mockConfirmAssistantChecklist).toHaveBeenCalledWith(
        DEMO_CASE_ID,
        CHECKLIST_RESPONSE.proposedChecklist,
        expect.any(String),
      );
      expect(screen.getByRole('button', { name: tt('completion.createTasks') })).toBeDisabled();
      expect(screen.getByRole('status')).toHaveTextContent(tt('completion.checklistSaving'));

      resolveConfirm?.();
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(tt('completion.checklistSaved')),
      );
      // Saved is terminal for this checklist: a third press must not create
      // the same tasks again.
      expect(screen.getByRole('button', { name: tt('completion.createTasks') })).toBeDisabled();
    });

    it('renders an alert when the confirmation is rejected and reuses the key on retry', async () => {
      mockAskCaseAssistant.mockResolvedValue(CHECKLIST_RESPONSE);
      mockConfirmAssistantChecklist
        .mockRejectedValueOnce(new Error('server error'))
        .mockResolvedValue(undefined);
      const button = await askForChecklist();
      fireEvent.click(button);
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(tt('completion.checklistFailed'));
      expect(screen.getByRole('button', { name: tt('completion.createTasks') })).toBeEnabled();

      fireEvent.click(screen.getByRole('button', { name: tt('completion.createTasks') }));
      await waitFor(() => expect(mockConfirmAssistantChecklist).toHaveBeenCalledTimes(2));
      const [first, second] = mockConfirmAssistantChecklist.mock.calls as Array<
        [string, string[], string]
      >;
      expect(typeof first?.[2]).toBe('string');
      expect(second?.[2]).toBe(first?.[2]);
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(tt('completion.checklistSaved')),
      );
    });

    it('reuses the review idempotency key after a failed escalation and mints a new one after success', async () => {
      mockCreateProfessionalReview
        .mockRejectedValueOnce(new Error('server error'))
        .mockResolvedValueOnce({ ...REQUESTED_REVIEW, id: 'rev-201' })
        .mockResolvedValue({ ...REQUESTED_REVIEW, id: 'rev-202' });
      renderPanel();
      await waitFor(() => screen.getByRole('button', { name: 'בקשת בדיקה' }));
      fireEvent.click(screen.getByRole('button', { name: 'בקשת בדיקה' }));
      await screen.findByText(tt('completion.escalateFailed'));
      fireEvent.click(screen.getByRole('button', { name: 'בקשת בדיקה' }));
      await waitFor(() => expect(mockCreateProfessionalReview).toHaveBeenCalledTimes(2));
      const keys = mockCreateProfessionalReview.mock.calls.map((call) => call[2] as string);
      expect(keys[1]).toBe(keys[0]);

      // Deliberately asking for another review after a success is a new
      // request, not a replay of the previous one.
      await waitFor(() => expect(screen.getByRole('button', { name: 'בקשת בדיקה' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'בקשת בדיקה' }));
      await waitFor(() => expect(mockCreateProfessionalReview).toHaveBeenCalledTimes(3));
      expect(mockCreateProfessionalReview.mock.calls[2]?.[2]).not.toBe(keys[0]);
    });
  });

  describe('honest failure states', () => {
    it('shows an error and a retry that reloads the case health after a failed load', async () => {
      mockGetCaseHealth.mockReset();
      mockGetCaseHealth.mockRejectedValueOnce(new Error('network down')).mockResolvedValue({
        score: 55,
        actionsRemaining: 1,
        factors: [],
      });
      renderPanel();
      await waitFor(() =>
        expect(
          screen.getByText('טעינת נתוני התיק נכשלה. שום נתון בתיק לא נפגע.'),
        ).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
      await waitFor(() => expect(screen.getByText('55')).toBeInTheDocument());
    });

    it('shows an error and a retry when the review list fails to load', async () => {
      mockListProfessionalReviews.mockReset();
      mockListProfessionalReviews
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValue([]);
      renderPanel();
      await waitFor(() =>
        expect(
          screen.getByText('טעינת בקשות הבדיקה נכשלה. שום נתון בתיק לא נפגע.'),
        ).toBeInTheDocument(),
      );
      expect(screen.queryByText('אין בקשות בדיקה פתוחות.')).not.toBeInTheDocument();
    });

    it('shows an error instead of silently pretending the escalation succeeded', async () => {
      mockCreateProfessionalReview.mockRejectedValue(new Error('server error'));
      renderPanel();
      await waitFor(() => screen.getByRole('button', { name: 'בקשת בדיקה' }));
      fireEvent.click(screen.getByRole('button', { name: 'בקשת בדיקה' }));
      await waitFor(() =>
        expect(screen.getByText('יצירת בקשת הבדיקה נכשלה. נסו שוב.')).toBeInTheDocument(),
      );
    });

    it('shows an error instead of an empty-looking audit history when it fails to load', async () => {
      mockListProfessionalReviews.mockResolvedValue([REQUESTED_REVIEW]);
      mockGetProfessionalReview.mockRejectedValue(new Error('server error'));
      renderPanel();
      await waitFor(() => screen.getByText(tt('escalation.status.requested')));
      fireEvent.click(screen.getByText(tt('escalation.history')));
      await waitFor(() => expect(screen.getByText('טעינת ההיסטוריה נכשלה.')).toBeInTheDocument());
    });
  });

  describe('escalation lifecycle', () => {
    it('shows the status badge, the manual-handoff disclaimer and the legal transition buttons', async () => {
      mockListProfessionalReviews.mockResolvedValue([REQUESTED_REVIEW]);
      renderPanel();
      await waitFor(() =>
        expect(screen.getByText(tt('escalation.status.requested'))).toBeInTheDocument(),
      );
      expect(screen.getByText(tt('escalation.manualHandoffDisclaimer'))).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: tt('escalation.transition.acknowledged') }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: tt('escalation.transition.cancelled') }),
      ).toBeInTheDocument();
      // Illegal jumps are never offered.
      expect(
        screen.queryByRole('button', { name: tt('escalation.transition.resolved') }),
      ).toBeNull();
    });

    it('sends a manual handoff transition with the free-text assignment', async () => {
      mockListProfessionalReviews.mockResolvedValue([REQUESTED_REVIEW]);
      mockTransitionProfessionalReview.mockResolvedValue({
        ...REQUESTED_REVIEW,
        status: 'acknowledged',
        assignedTo: 'עו"ד רות כהן, 03-0000000',
      });
      renderPanel();
      await waitFor(() => screen.getByText(tt('escalation.status.requested')));
      fireEvent.change(screen.getByLabelText(tt('escalation.assignedToLabel')), {
        target: { value: 'עו"ד רות כהן, 03-0000000' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: tt('escalation.transition.acknowledged') }),
      );
      await waitFor(() =>
        expect(mockTransitionProfessionalReview).toHaveBeenCalledWith(
          DEMO_CASE_ID,
          'rev-100',
          { status: 'acknowledged', assignedTo: 'עו"ד רות כהן, 03-0000000' },
          expect.any(String),
        ),
      );
      await waitFor(() =>
        expect(screen.getByText(tt('escalation.status.acknowledged'))).toBeInTheDocument(),
      );
    });

    it('keeps resolve disabled until a resolution note is entered', async () => {
      const inReview = { ...REQUESTED_REVIEW, status: 'in_review' };
      mockListProfessionalReviews.mockResolvedValue([inReview]);
      mockTransitionProfessionalReview.mockResolvedValue({
        ...inReview,
        status: 'resolved',
        resolutionNote: 'נבדק ידנית על ידי הגורם המקצועי.',
        resolvedAt: '2026-08-19T00:00:00.000Z',
      });
      renderPanel();
      await waitFor(() => screen.getByText(tt('escalation.status.in_review')));
      const resolveButton = screen.getByRole('button', {
        name: tt('escalation.transition.resolved'),
      });
      expect(resolveButton).toBeDisabled();
      fireEvent.change(screen.getByLabelText(tt('escalation.resolutionNoteLabel')), {
        target: { value: 'נבדק ידנית על ידי הגורם המקצועי.' },
      });
      expect(resolveButton).toBeEnabled();
      fireEvent.click(resolveButton);
      await waitFor(() =>
        expect(mockTransitionProfessionalReview).toHaveBeenCalledWith(
          DEMO_CASE_ID,
          'rev-100',
          { status: 'resolved', resolutionNote: 'נבדק ידנית על ידי הגורם המקצועי.' },
          expect.any(String),
        ),
      );
    });

    it('offers no transition buttons for a terminal review', async () => {
      mockListProfessionalReviews.mockResolvedValue([
        {
          ...REQUESTED_REVIEW,
          status: 'resolved',
          resolutionNote: 'טופל.',
          resolvedAt: '2026-08-19T00:00:00.000Z',
        },
      ]);
      renderPanel();
      await waitFor(() =>
        expect(screen.getByText(tt('escalation.status.resolved'))).toBeInTheDocument(),
      );
      expect(
        screen.queryByRole('button', { name: tt('escalation.transition.cancelled') }),
      ).toBeNull();
      expect(screen.queryByLabelText(tt('escalation.assignedToLabel'))).toBeNull();
    });
  });
});

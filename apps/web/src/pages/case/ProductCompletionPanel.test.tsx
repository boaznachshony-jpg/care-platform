import { render, screen, waitFor } from '@testing-library/react';
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

vi.mock('../../api/client.js', () => ({
  getCaseHealth: (...args: unknown[]) => mockGetCaseHealth(...args),
  listProfessionalReviews: (...args: unknown[]) => mockListProfessionalReviews(...args),
  askCaseAssistant: (...args: unknown[]) => mockAskCaseAssistant(...args),
  confirmAssistantChecklist: (...args: unknown[]) => mockConfirmAssistantChecklist(...args),
  createProfessionalReview: (...args: unknown[]) => mockCreateProfessionalReview(...args),
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

function renderPanel(caseId = DEMO_CASE_ID) {
  return render(
    <I18nextProvider i18n={initI18n()}>
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
    mockCreateProfessionalReview.mockResolvedValue({ id: 'rev-001', status: 'open', reason: '' });
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
    await waitFor(() =>
      expect(screen.getByText('אין בקשות בדיקה פתוחות.')).toBeInTheDocument(),
    );
  });

  it('calls getCaseHealth and listProfessionalReviews on mount', async () => {
    renderPanel();
    await waitFor(() => expect(mockGetCaseHealth).toHaveBeenCalledWith(DEMO_CASE_ID));
    expect(mockListProfessionalReviews).toHaveBeenCalledWith(DEMO_CASE_ID);
  });
});

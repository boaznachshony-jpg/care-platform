import { describe, expect, it } from 'vitest';
import {
  buildCaseContext,
  buildIntakeProposal,
  createEventPlan,
  requiresConfirmation,
  validateAssistantResponse,
  validateDateOrdering,
  validateExtractedDate,
  type CaseContextSnapshot,
  type ExtractedDocumentField,
} from '../index.js';
describe('smart intake safety', () => {
  it('rejects impossible and ambiguous dates without guessing locale', () => {
    expect(validateExtractedDate('2027-02-30').validationMessage).toBe('date_impossible');
    expect(validateExtractedDate('03/04/2027').validationStatus).toBe('ambiguous');
  });
  it('rejects expiry before issue and never invents reminders', () => {
    const field = (key: 'issue_date' | 'expiry_date', date: string): ExtractedDocumentField => ({
      key,
      proposedValue: date,
      normalizedValue: date,
      confidence: 0.9,
      provenance: 'ai',
      validationStatus: 'valid',
      userConfirmed: false,
    });
    expect(
      validateDateOrdering([
        field('issue_date', '2027-02-01'),
        field('expiry_date', '2027-01-01'),
      ])[1]?.validationMessage,
    ).toBe('expiry_before_issue');
    expect(
      buildIntakeProposal({
        documentId: 'd1',
        extraction: {
          classification: { family: 'passport', confidence: 0.9, provenance: 'ai' },
          fields: [],
          requiresManualReview: true,
        },
      }).reminder,
    ).toBeNull();
  });
  it('flags identity mismatch as a suggestion', () => {
    const proposal = buildIntakeProposal({
      documentId: 'd1',
      canonicalName: 'Synthetic One',
      extraction: {
        classification: { family: 'passport', confidence: 0.9, provenance: 'ai' },
        requiresManualReview: true,
        fields: [
          {
            key: 'holder_name',
            proposedValue: 'Synthetic Two',
            confidence: 0.8,
            provenance: 'ai',
            validationStatus: 'unverified',
            userConfirmed: false,
          },
        ],
      },
    });
    expect(proposal.identityMismatch).toBe(true);
    expect(proposal.state).toBe('ai_suggested');
  });
});
describe('case assistant safety', () => {
  const source: CaseContextSnapshot & { privateNotes?: string } = {
    caseSummary: { caseId: 'c1', status: 'active' },
    caregiverSummary: { displayName: 'Synthetic Caregiver' },
    documentStatusSummary: [
      { documentId: 'd1', type: 'passport', expiresAt: null, status: 'missing' },
    ],
    activeTasks: [],
    relevantTimelineEvents: [],
    relevantApprovedRules: [],
    privateNotes: 'excluded',
  };
  it('whitelists travel context and excludes irrelevant sensitive fields', () => {
    const snapshot = buildCaseContext('travel_check', source);
    expect(snapshot).not.toHaveProperty('privateNotes');
  });
  it('rejects fabricated facts and requires confirmation for mutation', () => {
    expect(() =>
      validateAssistantResponse(
        {
          answer: '',
          factsUsed: [{ factPath: 'privateNotes', label: 'x' }],
          uncertainties: [],
          recommendedActions: [],
        },
        buildCaseContext('travel_check', source),
      ),
    ).toThrow('assistant_fact_not_in_context');
    expect(
      requiresConfirmation({
        answer: '',
        factsUsed: [],
        uncertainties: [],
        recommendedActions: [{ type: 'create_task', label: 'x', mutatesCase: true }],
      }),
    ).toBe(true);
  });
});
describe('event wizards', () => {
  it('starts every catalog event and validates required answers', async () => {
    const { EVENT_WIZARDS } = await import('../index.js');
    expect(EVENT_WIZARDS).toHaveLength(8);
    expect(() =>
      createEventPlan('caregiver_travel', [], { caseId: 'c', documents: [], approvedRules: [] }),
    ).toThrow('required:departure_date');
  });
  it('builds a cautious travel plan and detects workflow', () => {
    const plan = createEventPlan(
      'caregiver_travel',
      [
        { questionId: 'departure_date', value: '2027-01-01' },
        { questionId: 'return_date', value: '2027-01-20' },
        { questionId: 'destination', value: 'Synthetic destination' },
        { questionId: 'intends_return', value: true },
      ],
      {
        caseId: 'c',
        documents: [],
        workflow: { type: 'visa_renewal', status: 'active' },
        approvedRules: [],
      },
    );
    expect(plan.uncertainties).toEqual([
      'missing_passport_validity',
      'missing_visa_validity',
      'no_approved_travel_rule',
    ]);
    expect(plan.items.some((item) => item.kind === 'open_workflow')).toBe(true);
  });
});

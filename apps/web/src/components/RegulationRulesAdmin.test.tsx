import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { RegulationRulesAdmin } from './RegulationRulesAdmin.js';
import type { RegulationRuleResponse } from '../api/client.js';

// Constitution §16: synthetic data only.
const mockListRegulationRules = vi.fn();
const mockCreateRegulationRule = vi.fn();
const mockTransitionRegulationRule = vi.fn();

vi.mock('../api/client.js', () => ({
  listRegulationRules: (...args: unknown[]) => mockListRegulationRules(...args),
  createRegulationRule: (...args: unknown[]) => mockCreateRegulationRule(...args),
  transitionRegulationRule: (...args: unknown[]) => mockTransitionRegulationRule(...args),
}));

// One shared instance also resolves regulation.* keys for assertions, so the
// tests keep passing once the pending i18n resources are merged (they assert
// through i18n.t, which returns the raw key until the resources land).
const i18n = initI18n();
const tt = (key: string) => i18n.t(key) as string;
// Labels contain inline <small> help text (repo form style), so label queries
// match on the translated prefix instead of the full text content.
const labelRe = (key: string) => new RegExp(`^${tt(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

const APPROVED_RULE: RegulationRuleResponse = {
  id: 'rule-001',
  ruleKey: 'weekly_rest_day',
  version: 1,
  title: 'מנוחה שבועית לעובד',
  statement: 'העובד זכאי למנוחה שבועית בכל שבוע.',
  sourceCitation: 'חוק שעות עבודה ומנוחה, התשי"א-1951',
  sourceAuthority: 'זרוע העבודה — משרד העבודה',
  requiresProfessionalValidation: true,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  status: 'approved',
  reviewedBy: 'Adv. Synthetic Reviewer',
  reviewedAt: '2026-08-01T00:00:00.000Z',
  activatedAt: null,
  retiredAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const IN_REVIEW_RULE: RegulationRuleResponse = {
  ...APPROVED_RULE,
  id: 'rule-002',
  ruleKey: 'synthetic_in_review',
  title: 'Synthetic in-review rule',
  status: 'in_review',
  reviewedBy: null,
  reviewedAt: null,
};

function renderAdmin() {
  return render(
    <I18nextProvider i18n={i18n}>
      <RegulationRulesAdmin />
    </I18nextProvider>,
  );
}

describe('RegulationRulesAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListRegulationRules.mockResolvedValue([APPROVED_RULE, IN_REVIEW_RULE]);
  });

  it('lists rules with status badge and full provenance', async () => {
    renderAdmin();
    expect(await screen.findByText('מנוחה שבועית לעובד')).toBeInTheDocument();
    expect(screen.getByText(tt('regulation.status.approved'))).toBeInTheDocument();
    // Both synthetic rules share the same source citation, so match all.
    expect(screen.getAllByText(/חוק שעות עבודה ומנוחה/)).toHaveLength(2);
    expect(screen.getAllByText(/v1/)[0]).toBeInTheDocument();
    expect(screen.getByText('Adv. Synthetic Reviewer')).toBeInTheDocument();
    // The fail-closed provenance flag is always visible.
    expect(screen.getAllByText(tt('regulation.requiresValidation'))).toHaveLength(2);
  });

  it('offers only the legal transition for each status and activates on click', async () => {
    mockTransitionRegulationRule.mockResolvedValue({
      rule: { ...APPROVED_RULE, status: 'active', activatedAt: '2026-08-19T00:00:00.000Z' },
      replayed: false,
    });
    renderAdmin();
    await screen.findByText('מנוחה שבועית לעובד');
    // An approved rule can only be activated — never retired or re-reviewed.
    expect(screen.queryByRole('button', { name: tt('regulation.retire') })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: tt('regulation.activate') }));
    await waitFor(() =>
      expect(mockTransitionRegulationRule).toHaveBeenCalledWith('rule-001', { status: 'active' }),
    );
    expect(await screen.findByText(tt('regulation.status.active'))).toBeInTheDocument();
  });

  it('requires a professional reviewer name before approval is enabled', async () => {
    mockTransitionRegulationRule.mockResolvedValue({
      rule: { ...IN_REVIEW_RULE, status: 'approved', reviewedBy: 'עו"ד בדיקה סינתטית' },
      replayed: false,
    });
    renderAdmin();
    await screen.findByText('Synthetic in-review rule');
    const approveButton = screen.getByRole('button', { name: tt('regulation.approve') });
    expect(approveButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(labelRe('regulation.reviewerName')), {
      target: { value: 'עו"ד בדיקה סינתטית' },
    });
    expect(approveButton).toBeEnabled();
    fireEvent.click(approveButton);
    await waitFor(() =>
      expect(mockTransitionRegulationRule).toHaveBeenCalledWith('rule-002', {
        status: 'approved',
        reviewedBy: 'עו"ד בדיקה סינתטית',
      }),
    );
  });

  it('shows an error when a transition is rejected by the server', async () => {
    mockTransitionRegulationRule.mockRejectedValue(new Error('INVALID_TRANSITION'));
    renderAdmin();
    await screen.findByText('מנוחה שבועית לעובד');
    fireEvent.click(screen.getByRole('button', { name: tt('regulation.activate') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(tt('regulation.transitionFailed'));
  });

  it('creates a draft through the authoring form', async () => {
    const draftRule: RegulationRuleResponse = {
      ...APPROVED_RULE,
      id: 'rule-003',
      ruleKey: 'synthetic_new_rule',
      title: 'Synthetic drafted rule',
      status: 'draft',
      reviewedBy: null,
      reviewedAt: null,
    };
    mockCreateRegulationRule.mockResolvedValue({ rule: draftRule, replayed: false });
    renderAdmin();
    await screen.findByText('מנוחה שבועית לעובד');
    const createButton = screen.getByRole('button', { name: tt('regulation.createDraft') });
    expect(createButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(labelRe('regulation.ruleKey')), {
      target: { value: 'synthetic_new_rule' },
    });
    fireEvent.change(screen.getByLabelText(labelRe('regulation.ruleTitle')), {
      target: { value: 'Synthetic drafted rule' },
    });
    fireEvent.change(screen.getByLabelText(labelRe('regulation.statement')), {
      target: { value: 'A synthetic conservative factual statement.' },
    });
    fireEvent.change(screen.getByLabelText(labelRe('regulation.source')), {
      target: { value: 'Synthetic citation' },
    });
    expect(createButton).toBeEnabled();
    fireEvent.click(createButton);
    await waitFor(() =>
      expect(mockCreateRegulationRule).toHaveBeenCalledWith(
        expect.objectContaining({
          ruleKey: 'synthetic_new_rule',
          title: 'Synthetic drafted rule',
          sourceCitation: 'Synthetic citation',
        }),
      ),
    );
    expect(await screen.findByText('Synthetic drafted rule')).toBeInTheDocument();
  });

  it('shows a load error when the listing fails', async () => {
    mockListRegulationRules.mockRejectedValue(new Error('REQUEST_ERROR'));
    renderAdmin();
    expect(await screen.findByRole('alert')).toHaveTextContent(tt('regulation.loadError'));
  });
});

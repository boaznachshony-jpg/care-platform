import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { ApiRequestError, listVisaRenewals, startVisaRenewal } from '../../api/client.js';
import { VisaRenewalSection } from './VisaRenewalSection.js';

vi.mock('../../api/client.js', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('../../api/client.js')>();
  return { ...original, listVisaRenewals: vi.fn(), startVisaRenewal: vi.fn() };
});

const workflow = {
  id: '10000000-0000-4000-8000-000000000001',
  employmentCaseId: 'case-1',
  templateVersionId: '10000000-0000-4000-8000-000000000002',
  currentAuthorizationId: '10000000-0000-4000-8000-000000000003',
  status: 'active' as const,
  evaluation: {
    status: 'active' as const,
    asOf: '2026-08-13',
    dueDate: null,
    priority: 'normal' as const,
    explanationKey: 'rule',
    sourceReferences: ['official-source'],
    reviewRequired: false,
  },
  assignments: [
    {
      stepKey: 'prepare',
      raciRole: 'responsible' as const,
      assigneeType: 'user' as const,
      assigneeId: '10000000-0000-4000-8000-000000000004',
    },
    {
      stepKey: 'prepare',
      raciRole: 'accountable' as const,
      assigneeType: 'user' as const,
      assigneeId: '10000000-0000-4000-8000-000000000005',
    },
  ],
  blockers: [],
  linkedRenewedAuthorizationId: null,
  linkedDocumentVersionId: null,
  completedAt: null,
};

describe('VisaRenewalSection', () => {
  beforeEach(() => {
    initI18n();
    vi.mocked(listVisaRenewals).mockReset();
    vi.mocked(startVisaRenewal).mockReset();
  });

  it('lists status, current step, evidence, RACI, blockers and authorization linkage', async () => {
    vi.mocked(listVisaRenewals).mockResolvedValue([workflow]);
    render(<VisaRenewalSection caseId="case-1" />);
    expect(await screen.findByText('תהליך חידוש', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getAllByText('prepare')).toHaveLength(3);
    expect(screen.getByText('1 מקורות מתועדים')).toBeInTheDocument();
    expect(screen.getByText('אין חסמים פעילים.')).toBeInTheDocument();
    expect(screen.getByText('עדיין לא קושר אישור מחודש.')).toBeInTheDocument();
  });

  it('surfaces an unverified-rule block without replacing it with a legal calculation', async () => {
    vi.mocked(listVisaRenewals).mockResolvedValue([
      {
        ...workflow,
        status: 'blocked',
        evaluation: {
          ...workflow.evaluation,
          status: 'unverified',
          sourceReferences: [],
          reviewRequired: true,
        },
        blockers: [
          {
            code: 'unverified_evidence',
            stepKey: 'verify',
            ownerAssignmentId: null,
            nextReviewAt: null,
          },
        ],
      },
    ]);
    render(<VisaRenewalSection caseId="case-1" />);
    expect(await screen.findByText('לא מאומת')).toBeInTheDocument();
    expect(screen.getByText(/הראיות טרם אומתו/)).toBeInTheDocument();
    expect(screen.getByText('נדרשת בדיקה מקצועית לפני המשך התהליך.')).toBeInTheDocument();
  });

  it('starts through the API and handles conflict feedback', async () => {
    vi.mocked(listVisaRenewals).mockResolvedValue([]);
    vi.mocked(startVisaRenewal).mockRejectedValue(
      new ApiRequestError(409, 'IDEMPOTENCY_KEY_REUSED'),
    );
    render(<VisaRenewalSection caseId="case-1" />);
    await screen.findByText('טרם התחיל תהליך חידוש');
    fireEvent.click(screen.getByText('התחלת תהליך חידוש'));
    const ids = [
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000005',
    ];
    fireEvent.change(screen.getByRole('textbox', { name: /מזהה גרסת תבנית/ }), {
      target: { value: ids[0] },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /מזהה האישור הנוכחי/ }), {
      target: { value: ids[1] },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /מזהה האחראי לביצוע/ }), {
      target: { value: ids[2] },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /מזהה בעל האחריות הכוללת/ }), {
      target: { value: ids[3] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'התחלת התהליך' }));
    await waitFor(() => expect(startVisaRenewal).toHaveBeenCalledOnce());
    expect(await screen.findByText(/הבקשה מתנגשת/)).toBeInTheDocument();
  });

  // Defect 1: startVisaRenewal used to generate a fresh crypto.randomUUID()
  // idempotency key inside client.ts on every call, so pressing "start" again
  // after a lost response (same form, same data) minted a different key and
  // the server created a second workflow. The key must now stay the same
  // across a retry with unchanged inputs.
  it('reuses the same idempotency key when retrying the same start form after a failure', async () => {
    vi.mocked(listVisaRenewals).mockResolvedValue([]);
    vi.mocked(startVisaRenewal).mockRejectedValue(new Error('network error'));
    render(<VisaRenewalSection caseId="case-1" />);
    await screen.findByText('טרם התחיל תהליך חידוש');
    fireEvent.click(screen.getByText('התחלת תהליך חידוש'));
    const ids = [
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000005',
    ];
    fireEvent.change(screen.getByRole('textbox', { name: /מזהה גרסת תבנית/ }), {
      target: { value: ids[0] },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /מזהה האישור הנוכחי/ }), {
      target: { value: ids[1] },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /מזהה האחראי לביצוע/ }), {
      target: { value: ids[2] },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /מזהה בעל האחריות הכוללת/ }), {
      target: { value: ids[3] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'התחלת התהליך' }));
    await waitFor(() => expect(startVisaRenewal).toHaveBeenCalledTimes(1));

    // Retry with the exact same field values — as if the user pressed the
    // button again after the first response was lost.
    fireEvent.click(screen.getByRole('button', { name: 'התחלת התהליך' }));
    await waitFor(() => expect(startVisaRenewal).toHaveBeenCalledTimes(2));

    const [, , firstKey] = vi.mocked(startVisaRenewal).mock.calls[0]!;
    const [, , secondKey] = vi.mocked(startVisaRenewal).mock.calls[1]!;
    expect(secondKey).toBe(firstKey);
    expect(typeof secondKey).toBe('string');
  });
});

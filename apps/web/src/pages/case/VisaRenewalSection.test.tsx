import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import {
  ApiRequestError,
  listCaseAuthorizations,
  listCaseCollaborationMembers,
  listVisaRenewals,
  listWorkflowTemplates,
  startVisaRenewal,
} from '../../api/client.js';
import { VisaRenewalSection } from './VisaRenewalSection.js';

vi.mock('../../api/client.js', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('../../api/client.js')>();
  return {
    ...original,
    listVisaRenewals: vi.fn(),
    startVisaRenewal: vi.fn(),
    listWorkflowTemplates: vi.fn(),
    listCaseAuthorizations: vi.fn(),
    listCaseCollaborationMembers: vi.fn(),
  };
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

// Deliberately unregistered i18n keys — proves the template/step name falls
// back to something readable (the key itself) instead of disappearing when a
// server-added template hasn't been translated yet.
const template = {
  templateVersionId: '20000000-0000-4000-8000-000000000001',
  templateKey: 'work_visa_renewal',
  nameKey: 'template.work_visa_renewal.name',
  version: 3,
  steps: [
    { stepKey: 'prepare_application', titleKey: 'step.prepare_application.title', position: 1 },
    { stepKey: 'submit_to_bureau', titleKey: 'step.submit_to_bureau.title', position: 2 },
  ],
};

const authorization = {
  id: '20000000-0000-4000-8000-000000000002',
  status: 'current' as const,
  validFrom: '2025-01-01',
  validUntil: '2026-01-01',
};

const memberOne = {
  id: '20000000-0000-4000-8000-000000000003',
  display_name: 'דנה לוי',
  role: 'owner',
  status: 'active',
};
const memberTwo = {
  id: '20000000-0000-4000-8000-000000000004',
  display_name: 'יוסי כהן',
  role: 'manager',
  status: 'active',
};

/** Resolves all three "start" picker sources with one template, one authorization, two members. */
function mockPickersReady() {
  vi.mocked(listWorkflowTemplates).mockResolvedValue([template]);
  vi.mocked(listCaseAuthorizations).mockResolvedValue([authorization]);
  vi.mocked(listCaseCollaborationMembers).mockResolvedValue({ members: [memberOne, memberTwo] });
}

async function openStartForm() {
  fireEvent.click(screen.getByText('התחלת תהליך חידוש'));
  return screen.findByRole('combobox', { name: 'תבנית התהליך' });
}

describe('VisaRenewalSection', () => {
  beforeEach(() => {
    initI18n();
    vi.mocked(listVisaRenewals).mockReset();
    vi.mocked(startVisaRenewal).mockReset();
    vi.mocked(listWorkflowTemplates).mockReset();
    vi.mocked(listCaseAuthorizations).mockReset();
    vi.mocked(listCaseCollaborationMembers).mockReset();
    mockPickersReady();
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

  it('offers the real options for every picker instead of a raw-id text box', async () => {
    vi.mocked(listVisaRenewals).mockResolvedValue([]);
    render(<VisaRenewalSection caseId="case-1" />);
    await screen.findByText('טרם התחיל תהליך חידוש');
    const templateSelect = await openStartForm();

    // Template: name-key fallback and version number, not a uuid input.
    expect(
      // The label falls back to the template key when the locale has no name
      // for it — a human-readable word plus the version, never the uuid.
      within(templateSelect).getByText('work_visa_renewal · v3'),
    ).toBeInTheDocument();

    // Step: populated from the selected template's own steps, title-key fallback.
    const stepSelect = screen.getByRole('combobox', { name: 'שלב הפתיחה' });
    // Same fallback rule as the template label: with no locale entry for the
    // title key, the option shows the step key itself — a readable word, not
    // an identifier the family would have had to know.
    expect(within(stepSelect).getByText('prepare_application')).toBeInTheDocument();
    expect(within(stepSelect).getByText('submit_to_bureau')).toBeInTheDocument();

    // Current authorization: status label and validity dates, never the id.
    const authSelect = screen.getByRole('combobox', { name: 'היתר העבודה הנוכחי' });
    expect(within(authSelect).getByText('בתוקף · 2025-01-01 – 2026-01-01')).toBeInTheDocument();
    expect(screen.queryByText(authorization.id)).not.toBeInTheDocument();

    // Responsible/accountable: family member names, never their ids.
    const responsibleSelect = screen.getByRole('combobox', { name: 'אחראי לביצוע' });
    expect(within(responsibleSelect).getByText('דנה לוי')).toBeInTheDocument();
    expect(within(responsibleSelect).getByText('יוסי כהן')).toBeInTheDocument();
    expect(screen.queryByText(memberOne.id)).not.toBeInTheDocument();
  });

  it('sends the selected ids — not typed text — to the start API', async () => {
    vi.mocked(listVisaRenewals).mockResolvedValue([]);
    vi.mocked(startVisaRenewal).mockResolvedValue({ ...workflow });
    render(<VisaRenewalSection caseId="case-1" />);
    await screen.findByText('טרם התחיל תהליך חידוש');
    await openStartForm();

    fireEvent.change(screen.getByRole('combobox', { name: 'שלב הפתיחה' }), {
      target: { value: 'submit_to_bureau' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'אחראי לביצוע' }), {
      target: { value: memberOne.id },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'בעל האחריות הכוללת' }), {
      target: { value: memberTwo.id },
    });

    fireEvent.click(screen.getByRole('button', { name: 'התחלת התהליך' }));
    await waitFor(() => expect(startVisaRenewal).toHaveBeenCalledOnce());

    const [sentCaseId, sentBody] = vi.mocked(startVisaRenewal).mock.calls[0]!;
    expect(sentCaseId).toBe('case-1');
    expect(sentBody.templateVersionId).toBe(template.templateVersionId);
    expect(sentBody.currentAuthorizationId).toBe(authorization.id);
    expect(sentBody.assignments).toEqual([
      {
        stepKey: 'submit_to_bureau',
        raciRole: 'responsible',
        assigneeType: 'user',
        assigneeId: memberOne.id,
      },
      {
        stepKey: 'submit_to_bureau',
        raciRole: 'accountable',
        assigneeType: 'user',
        assigneeId: memberTwo.id,
      },
    ]);
  });

  it('starts through the API and handles conflict feedback', async () => {
    vi.mocked(listVisaRenewals).mockResolvedValue([]);
    vi.mocked(startVisaRenewal).mockRejectedValue(
      new ApiRequestError(409, 'IDEMPOTENCY_KEY_REUSED'),
    );
    render(<VisaRenewalSection caseId="case-1" />);
    await screen.findByText('טרם התחיל תהליך חידוש');
    await openStartForm();
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
    await openStartForm();

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

  it('hides the form and explains what to do when no template is approved yet', async () => {
    vi.mocked(listVisaRenewals).mockResolvedValue([]);
    vi.mocked(listWorkflowTemplates).mockResolvedValue([]);
    render(<VisaRenewalSection caseId="case-1" />);
    await screen.findByText('טרם התחיל תהליך חידוש');
    fireEvent.click(screen.getByText('התחלת תהליך חידוש'));
    expect(await screen.findByText('אין עדיין תבנית חידוש מאושרת')).toBeInTheDocument();
    expect(screen.getByText(/פנו לצוות התמיכה של CareDesk כדי להפעיל תבנית/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('hides the form and explains what to do when the case has no authorization on file', async () => {
    vi.mocked(listVisaRenewals).mockResolvedValue([]);
    vi.mocked(listCaseAuthorizations).mockResolvedValue([]);
    render(<VisaRenewalSection caseId="case-1" />);
    await screen.findByText('טרם התחיל תהליך חידוש');
    fireEvent.click(screen.getByText('התחלת תהליך חידוש'));
    expect(await screen.findByText('אין היתר עבודה רשום בתיק')).toBeInTheDocument();
    expect(screen.getByText(/פנו למנהל\/ת התיק להוספת ההיתר הנוכחי/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('hides the form and explains what to do when the case has no family members yet', async () => {
    vi.mocked(listVisaRenewals).mockResolvedValue([]);
    vi.mocked(listCaseCollaborationMembers).mockResolvedValue({ members: [] });
    render(<VisaRenewalSection caseId="case-1" />);
    await screen.findByText('טרם התחיל תהליך חידוש');
    fireEvent.click(screen.getByText('התחלת תהליך חידוש'));
    expect(await screen.findByText('אין עדיין בני משפחה רשומים בתיק')).toBeInTheDocument();
    expect(screen.getByText(/להזמין בן משפחה לתיק/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows a retry action when the picker sources fail to load, and refetches on retry', async () => {
    vi.mocked(listVisaRenewals).mockResolvedValue([]);
    vi.mocked(listWorkflowTemplates).mockRejectedValueOnce(new Error('network error'));
    render(<VisaRenewalSection caseId="case-1" />);
    await screen.findByText('טרם התחיל תהליך חידוש');
    fireEvent.click(screen.getByText('התחלת תהליך חידוש'));
    expect(await screen.findByText('לא ניתן לטעון את אפשרויות הבחירה כרגע.')).toBeInTheDocument();

    vi.mocked(listWorkflowTemplates).mockResolvedValue([template]);
    fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    expect(await screen.findByRole('combobox', { name: 'תבנית התהליך' })).toBeInTheDocument();
  });
});

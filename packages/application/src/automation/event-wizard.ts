export const EVENT_TYPES = [
  'caregiver_resigned',
  'employer_termination',
  'recipient_hospitalized',
  'recipient_died',
  'move_to_institution',
  'caregiver_travel',
  'caregiver_did_not_return',
  'replace_caregiver',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export interface EventWizardQuestion {
  id: string;
  type: 'date' | 'text' | 'boolean';
  required: boolean;
  labelKey: string;
}
export interface EventWizardDefinition {
  type: EventType;
  questions: EventWizardQuestion[];
}
export interface EventWizardAnswer {
  questionId: string;
  value: string | boolean;
}
export interface EventWizardContext {
  caseId: string;
  documents: { type: string; expiresAt: string | null }[];
  workflow?: { type: string; status: string };
  approvedRules: { id: string; version: string }[];
}
export interface EventActionItem {
  id: string;
  kind: 'check' | 'create_task' | 'open_workflow' | 'professional_review';
  labelKey: string;
  source?: { ruleId: string; version: string };
}
export interface EventActionPlan {
  eventType: EventType;
  eventDate: string | null;
  items: EventActionItem[];
  uncertainties: string[];
  status: 'preview' | 'confirmed' | 'cancelled';
}

const eventDate: EventWizardQuestion = {
  id: 'event_date',
  type: 'date',
  required: true,
  labelKey: 'automation.eventDate',
};
export const EVENT_WIZARDS: readonly EventWizardDefinition[] = EVENT_TYPES.map((type) => ({
  type,
  questions:
    type === 'caregiver_travel'
      ? [
          {
            id: 'departure_date',
            type: 'date',
            required: true,
            labelKey: 'automation.departureDate',
          },
          { id: 'return_date', type: 'date', required: true, labelKey: 'automation.returnDate' },
          { id: 'destination', type: 'text', required: true, labelKey: 'automation.destination' },
          {
            id: 'intends_return',
            type: 'boolean',
            required: true,
            labelKey: 'automation.intendsReturn',
          },
        ]
      : [eventDate, { id: 'reason', type: 'text', required: false, labelKey: 'automation.reason' }],
}));

export function createEventPlan(
  type: EventType,
  answers: readonly EventWizardAnswer[],
  context: EventWizardContext,
): EventActionPlan {
  const definition = EVENT_WIZARDS.find((item) => item.type === type)!;
  for (const question of definition.questions)
    if (
      question.required &&
      !answers.some((answer) => answer.questionId === question.id && answer.value !== '')
    )
      throw new Error(`required:${question.id}`);
  const value = (id: string) =>
    String(answers.find((answer) => answer.questionId === id)?.value ?? '');
  if (type === 'caregiver_travel' && value('return_date') <= value('departure_date'))
    throw new Error('travel_date_order');
  const items: EventActionItem[] = [
    { id: 'review-open-work', kind: 'check', labelKey: 'automation.reviewOpenWork' },
  ];
  const uncertainties: string[] = [];
  if (type === 'caregiver_travel') {
    for (const doc of ['passport', 'visa'])
      if (!context.documents.some((item) => item.type === doc && item.expiresAt))
        uncertainties.push(`missing_${doc}_validity`);
    if (context.workflow?.type === 'visa_renewal')
      items.push({
        id: 'visa-workflow',
        kind: 'open_workflow',
        labelKey: 'automation.openVisaRenewal',
      });
    if (context.approvedRules.length === 0) {
      uncertainties.push('no_approved_travel_rule');
      items.push({
        id: 'review',
        kind: 'professional_review',
        labelKey: 'automation.professionalReview',
      });
    }
  } else if (['caregiver_resigned', 'employer_termination', 'recipient_died'].includes(type)) {
    items.push(
      { id: 'payroll-review', kind: 'check', labelKey: 'automation.reviewPayrollClose' },
      {
        id: 'professional',
        kind: 'professional_review',
        labelKey: 'automation.professionalReview',
      },
    );
  }
  return {
    eventType: type,
    eventDate: value(type === 'caregiver_travel' ? 'departure_date' : 'event_date') || null,
    items,
    uncertainties,
    status: 'preview',
  };
}

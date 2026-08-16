/* eslint-disable no-restricted-syntax -- adapter returns existing Hebrew domain labels */
import {
  projectCaseHealth,
  projectComplianceTimeline,
  projectFutureCost,
  projectPayrollAnalytics,
  type AttentionFact,
  type HealthFactor,
} from '@caredesk/application';
import type {
  MvpDocument,
  MvpEmploymentExpense,
  MvpMonthlyClose,
  MvpPayrollRecord,
  MvpProfile,
  MvpTask,
} from './storage/mvp-storage.js';

export function productIntelligence(input: {
  clientId: string;
  today: string;
  profile: MvpProfile;
  tasks: MvpTask[];
  documents: MvpDocument[];
  payroll: MvpPayrollRecord[];
  closes: MvpMonthlyClose[];
}) {
  const scope = { tenantId: input.clientId, caseId: input.clientId };
  const facts: AttentionFact[] = input.tasks.map((task) => ({
    ...scope,
    id: `task:${task.id}`,
    sourceType: task.source === 'visa-renewal' ? 'workflow' : 'task',
    title: task.title,
    dueDate: task.dueDate,
    status: task.status === 'completed' ? 'completed' : 'open',
    reason: task.source
      ? 'Generated from the date saved in the employment file'
      : 'User-created task',
    actionTarget: task.source === 'medical-insurance' ? '/documents' : '/tasks',
    provenance: { sourceId: task.id },
  }));
  const currentMonth = input.today.slice(0, 7);
  const currentPayroll = input.payroll.find((record) => record.month === currentMonth);
  if (currentPayroll && !input.closes.some((close) => close.month === currentMonth))
    facts.push({
      ...scope,
      id: `monthly-close:${currentPayroll.id}`,
      sourceType: 'monthly_close',
      title: `סגירת שכר ${currentMonth}`,
      dueDate: `${currentMonth}-${new Date(Date.UTC(Number(currentMonth.slice(0, 4)), Number(currentMonth.slice(5, 7)), 0)).getUTCDate()}`,
      status: 'open',
      reason: 'קיים רישום שכר שמור שטרם נסגר',
      actionTarget: '/payroll#monthly-close',
      provenance: { sourceId: currentPayroll.id },
    });
  const factors: HealthFactor[] = [
    {
      id: 'agreement',
      title: 'הסכם העסקה',
      status: input.profile.employmentAgreementConfirmed ? 'good' : 'attention',
      points: input.profile.employmentAgreementConfirmed ? 20 : 0,
      weight: 20,
      explanation: input.profile.employmentAgreementConfirmed
        ? 'קיומו אושר בתיק'
        : 'קיומו טרם אושר',
      recommendedAction: 'עדכון פרטי העסקה',
      actionTarget: '/settings',
      provenance: { sourceType: 'profile', sourceIds: ['employmentAgreementConfirmed'] },
    },
    ...(['licenseRenewalDate', 'visaRenewalDate'] as const).map((key) => ({
      id: key,
      title: key === 'licenseRenewalDate' ? 'היתר העסקה' : 'ויזה',
      status: input.profile[key] ? ('good' as const) : ('attention' as const),
      points: input.profile[key] ? 20 : 0,
      weight: 20,
      explanation: input.profile[key] ? 'מועד שמור בתיק' : 'לא נשמר מועד',
      recommendedAction: 'עדכון מועד',
      actionTarget: '/settings',
      provenance: { sourceType: 'profile' as const, sourceIds: [key] },
    })),
    {
      id: 'insurance',
      title: 'ביטוח רפואי',
      status:
        input.profile.medicalInsuranceConfirmed && input.profile.medicalInsuranceExpiryDate
          ? 'good'
          : 'attention',
      points:
        input.profile.medicalInsuranceConfirmed && input.profile.medicalInsuranceExpiryDate
          ? 20
          : 0,
      weight: 20,
      explanation: input.profile.medicalInsuranceConfirmed
        ? 'פרטי הכיסוי נשמרו'
        : 'לא אושר רישום ביטוח',
      recommendedAction: 'עדכון ביטוח',
      actionTarget: '/documents',
      provenance: { sourceType: 'insurance', sourceIds: ['medicalInsuranceExpiryDate'] },
    },
    {
      id: 'overdue',
      title: 'משימות באיחור',
      status: facts.some((f) => f.status === 'open' && f.dueDate < input.today)
        ? 'attention'
        : 'good',
      points: facts.some((f) => f.status === 'open' && f.dueDate < input.today) ? 0 : 20,
      weight: 20,
      explanation: 'מבוסס רק על משימות עם מועד שמור',
      recommendedAction: 'טיפול במשימות',
      actionTarget: '/tasks',
      provenance: {
        sourceType: 'task',
        sourceIds: facts
          .filter((fact) => fact.status === 'open')
          .map((fact) => fact.provenance.sourceId),
      },
    },
  ];
  return {
    timeline: projectComplianceTimeline({ ...scope, today: input.today, facts }),
    health: projectCaseHealth(factors),
  };
}

export function payrollIntelligence(
  records: MvpPayrollRecord[],
  closes: MvpMonthlyClose[],
  expenses: MvpEmploymentExpense[],
  year: string,
  startMonth: string,
  baseSalary: number | null,
) {
  const analytics = projectPayrollAnalytics(
    records.map((r) => ({
      month: r.month,
      baseSalary: r.baseSalary,
      additions:
        (r.saturdayPay ?? 0) +
        (r.holidayPay ?? 0) +
        (r.vacationPay ?? 0) +
        (r.sickPay ?? 0) +
        (r.employerContributions ?? 0) +
        r.otherAddition +
        (r.additionalPayments ?? []).reduce((s, p) => s + p.amount, 0),
      deductions:
        (r.medicalInsuranceDeduction ?? 0) +
        (r.housingDeduction ?? 0) +
        r.advances +
        r.agreedDeduction,
      total: r.total,
      closed: closes.some((c) => c.month === r.month),
    })),
    year,
  );
  const forecast = projectFutureCost({
    startMonth,
    baseSalary: baseSalary ?? undefined,
    actuals: records
      .filter((record) => closes.some((close) => close.month === record.month))
      .map((record) => ({ month: record.month, amount: record.total, sourceId: record.id })),
    expenses: expenses
      .filter((e) => e.amountEntered !== false)
      .map((e) => ({
        id: e.id,
        label: e.category,
        amount: e.amount,
        frequency: e.frequency,
        dueDate: e.dueDate,
      })),
  });
  return { analytics, forecast };
}

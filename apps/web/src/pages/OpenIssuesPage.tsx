import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useClientPath } from '../hooks/use-client-path.js';
import { useMvpProfile } from '../hooks/use-mvp-profile.js';
import { getCaseHealth, type CaseHealthResponse } from '../api/client.js';
import {
  healthFactorAction,
  healthFactorExplanation,
  healthFactorTitle,
} from '../health-factors.js';
import {
  OpenIssuesGlance,
  type OpenIssue,
  type OpenIssueSeverity,
} from '../components/OpenIssuesGlance.js';
import type { MvpProfile } from '../storage/mvp-storage.js';
import { createUpcomingPayments, formatDisplayDate } from '../upcoming-payments.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const URGENT_WINDOW_DAYS = 14;
const SOON_WINDOW_DAYS = 30;

function daysUntil(isoDate: string): number {
  return Math.ceil((new Date(isoDate).getTime() - Date.now()) / DAY_MS);
}

function expirySeverity(days: number): OpenIssueSeverity {
  if (days < URGENT_WINDOW_DAYS) return 'urgent';
  if (days < SOON_WINDOW_DAYS) return 'soon';
  return 'ok';
}

/** Same 14-field completeness list as DashboardPage, keyed for readable labels. */
function missingProfileFieldKeys(profile: MvpProfile): string[] {
  const checks: Array<[key: string, missing: boolean]> = [
    ['employerName', !profile.employerName.trim()],
    ['recipientName', !profile.recipientName.trim()],
    ['caregiverName', !profile.caregiverName.trim()],
    ['employmentStartDate', !profile.employmentStartDate.trim()],
    ['representativeName', !profile.representativeName.trim()],
    ['licensedBureauName', !profile.licensedBureauName.trim()],
    ['licensedBureauContactName', !profile.licensedBureauContactName.trim()],
    ['licensedBureauContactPhone', !profile.licensedBureauContactPhone.trim()],
    ['employmentAgreementConfirmed', !profile.employmentAgreementConfirmed],
    ['medicalInsurance', !profile.medicalInsuranceConfirmed || !profile.medicalInsuranceExpiryDate],
    ['baseSalary', (profile.baseSalary ?? 0) <= 0],
    ['saturdayRate', (profile.saturdayRate ?? 0) <= 0],
    ['licenseRenewalDate', !profile.licenseRenewalDate],
    ['visaRenewalDate', !profile.visaRenewalDate],
  ];
  return checks.filter(([, missing]) => missing).map(([key]) => key);
}

export function OpenIssuesPage() {
  const { t } = useTranslation();
  const path = useClientPath();
  const [profile] = useMvpProfile();
  const { clientId } = useParams<{ clientId: string }>();
  const [health, setHealth] = useState<CaseHealthResponse>();
  useEffect(() => {
    if (clientId) void getCaseHealth(clientId).then(setHealth);
  }, [clientId]);

  const issues: OpenIssue[] = [];

  for (const factor of health?.factors ?? []) {
    if (factor.status === 'attention') {
      // The API answers in English. This page is the one a family opens to see
      // what needs doing, so every one of the three strings is localised — the
      // action label included, since it is the only one that is a link.
      issues.push({
        id: `factor-${factor.id}`,
        severity: 'urgent',
        title: healthFactorTitle(factor, t),
        explanation: healthFactorExplanation(factor, t),
        actionLabel: healthFactorAction(factor, t),
        actionTo: factor.actionTarget ? path(factor.actionTarget) : undefined,
      });
    } else if (factor.status === 'good') {
      issues.push({
        id: `factor-${factor.id}`,
        severity: 'ok',
        title: healthFactorTitle(factor, t),
        explanation: healthFactorExplanation(factor, t),
      });
    }
  }

  const missingKeys = missingProfileFieldKeys(profile);
  if (missingKeys.length > 0) {
    issues.push({
      id: 'missing-fields',
      severity: 'soon',
      title: t('openIssues.missingTitle', { count: missingKeys.length }),
      explanation: missingKeys.map((key) => t(`openIssues.fields.${key}`)).join(', '),
      actionLabel: t('openIssues.completeInSettings'),
      actionTo: path('/settings'),
    });
  }

  const expiryDates: Array<[key: string, isoDate: string]> = [
    ['visa', profile.visaRenewalDate],
    ['license', profile.licenseRenewalDate],
    ['insurance', profile.medicalInsuranceExpiryDate],
  ];
  for (const [key, isoDate] of expiryDates) {
    if (!isoDate) continue; // Missing dates are already covered by the missing-fields issue.
    const days = daysUntil(isoDate);
    const severity = expirySeverity(days);
    issues.push({
      id: `expiry-${key}`,
      severity,
      title: t(`openIssues.dates.${key}`),
      explanation:
        days < 0
          ? t('openIssues.expiredDaysAgo', { count: -days })
          : t('openIssues.expiresInDays', { count: days }),
      ...(severity === 'ok'
        ? {}
        : { actionLabel: t('openIssues.reviewDates'), actionTo: path('/settings') }),
    });
  }

  for (const payment of createUpcomingPayments()) {
    if (payment.daysRemaining > SOON_WINDOW_DAYS) continue;
    issues.push({
      id: `payment-${payment.id}`,
      severity: 'soon',
      title: t(`payments.${payment.id}Title`),
      explanation: `${t('payments.dueDate', { date: formatDisplayDate(payment.dueDate) })} · ${
        payment.daysRemaining === 0
          ? t('payments.dueToday')
          : t('payments.daysRemaining', { count: payment.daysRemaining })
      }`,
      actionLabel: payment.id === 'salary' ? t('payments.openPayroll') : t('payments.openTasks'),
      actionTo: path(payment.id === 'salary' ? '/payroll' : '/tasks'),
    });
  }

  return (
    <div className="page-stack">
      <OpenIssuesGlance issues={issues} score={health?.score} />
    </div>
  );
}

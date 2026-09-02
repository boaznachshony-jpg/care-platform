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
import { OpenIssuesGlance, type OpenIssue } from '../components/OpenIssuesGlance.js';
import { createUpcomingPayments, formatDisplayDate } from '../upcoming-payments.js';
import { SOON_WINDOW_DAYS, daysUntil, expirySeverity } from '../date-diff.js';
import { missingProfileFieldKeys } from '../profile-completeness.js';

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
        // factor.actionTarget is already an app-rooted path from the health API
        // ("/cases/{id}#..."), not one relative to this client workspace.
        // Wrapping it in `path()` (which prefixes /clients/:clientId) produced
        // a URL matching no route, so the router's catch-all silently sent the
        // user to /app instead of the case screen — the urgent-action button
        // did nothing, with no error.
        actionTo: factor.actionTarget,
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
    if (days === null) continue; // Malformed date — nothing sane to show, and no false certainty either.
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

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import type { EmploymentCaseResponse } from '@caredesk/schemas';
import { ErrorState, Skeleton, StatusBadge, type StatusTone } from '@caredesk/ui';
import { ApiRequestError, getEmploymentCase } from '../api/client.js';
import { CaseContactsSection } from './case/CaseContactsSection.js';
import { CaseDocumentsSection } from './case/CaseDocumentsSection.js';
import { CaseTasksSection } from './case/CaseTasksSection.js';
import { CaseTimelineSection } from './case/CaseTimelineSection.js';
import { VisaRenewalSection } from './case/VisaRenewalSection.js';
import { AutomationPanel } from './case/AutomationPanel.js';
import { ProductCompletionPanel } from './case/ProductCompletionPanel.js';
import { CollaborationPanel } from './case/CollaborationPanel.js';
import { CanonicalPayrollIntelligence } from './case/CanonicalPayrollIntelligence.js';

type CaseState =
  | { kind: 'loading' }
  | { kind: 'loaded'; data: EmploymentCaseResponse }
  | { kind: 'not_found' }
  | { kind: 'error' };

/**
 * Every value the CHECK constraint on employment_case.status allows
 * (database/migrations/0003_care_employment_core.sql), each with its own
 * label and tone. Before this, everything that was not 'draft' rendered as
 * "פעיל" — a suspended or ended case read as active, which is a lie on a
 * screen a family reads to know whether their employment relationship is
 * still in force.
 */
const CASE_STATUS_PRESENTATION: Record<string, { labelKey: string; tone: StatusTone }> = {
  draft: { labelKey: 'case.statusDraft', tone: 'neutral' },
  active: { labelKey: 'case.statusActive', tone: 'success' },
  suspended: { labelKey: 'case.statusSuspended', tone: 'warning' },
  ended: { labelKey: 'case.statusEnded', tone: 'neutral' },
  cancelled: { labelKey: 'case.statusCancelled', tone: 'danger' },
  archived: { labelKey: 'case.statusArchived', tone: 'neutral' },
};

export function CasePage() {
  const { t } = useTranslation();
  const { caseId } = useParams<{ caseId: string }>();
  const [state, setState] = useState<CaseState>({ kind: 'loading' });

  useEffect(() => {
    if (!caseId) {
      setState({ kind: 'not_found' });
      return;
    }
    let cancelled = false;
    getEmploymentCase(caseId)
      .then((data) => {
        if (!cancelled) setState({ kind: 'loaded', data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiRequestError && error.status === 404) {
          setState({ kind: 'not_found' });
        } else {
          setState({ kind: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  if (state.kind === 'loading') {
    return <Skeleton loadingLabel={t('shell.loading')} height="2rem" width="20rem" />;
  }
  if (state.kind === 'not_found') {
    return <ErrorState kind="validation" title={t('case.caseNotFound')} body="" />;
  }
  if (state.kind === 'error') {
    return <ErrorState kind="retryable" title={t('case.loadFailed')} body="" />;
  }

  const { data } = state;
  // Fallback covers a status value this build does not yet know the label
  // for (e.g. a CHECK constraint value added by a migration this deploy
  // predates) — 'neutral' + the raw value is honest without guessing.
  const statusPresentation = CASE_STATUS_PRESENTATION[data.status] ?? {
    labelKey: null,
    tone: 'neutral' as StatusTone,
  };
  const statusLabel = statusPresentation.labelKey ? t(statusPresentation.labelKey) : data.status;

  return (
    <div>
      <h1>{t('case.viewTitle')}</h1>
      <StatusBadge tone={statusPresentation.tone} label={statusLabel} />

      <dl>
        <dt>{t('case.recipientFullName')}</dt>
        <dd>{data.careRecipient.fullName}</dd>

        <dt>{t('case.employerFullName')}</dt>
        <dd>{data.employer.fullName}</dd>

        <dt>{t('case.employerRelationship')}</dt>
        <dd>{data.employer.relationshipToRecipient}</dd>

        <dt>{t('case.caregiverLegalName')}</dt>
        <dd dir="ltr">{data.caregiver.legalName}</dd>

        <dt>{t('case.caregiverNationality')}</dt>
        <dd>{data.caregiver.nationality}</dd>

        <dt>{t('case.startDate')}</dt>
        <dd dir="ltr">{data.startDate}</dd>
      </dl>

      <AutomationPanel caseId={data.id} />
      <ProductCompletionPanel caseId={data.id} />
      <CanonicalPayrollIntelligence caseId={data.id} />

      <VisaRenewalSection caseId={data.id} />
      <CollaborationPanel caseId={data.id} />

      <CaseTasksSection caseId={data.id} />
      <CaseDocumentsSection caseId={data.id} />
      <CaseContactsSection caseId={data.id} />
      <CaseTimelineSection caseId={data.id} />
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import type { EmploymentCaseResponse } from '@caredesk/schemas';
import { ErrorState, Skeleton, StatusBadge } from '@caredesk/ui';
import { ApiRequestError, getEmploymentCase } from '../api/client.js';

type CaseState =
  | { kind: 'loading' }
  | { kind: 'loaded'; data: EmploymentCaseResponse }
  | { kind: 'not_found' }
  | { kind: 'error' };

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
  const statusLabel = data.status === 'draft' ? t('case.statusDraft') : t('case.statusActive');

  return (
    <div>
      <h1>{t('case.viewTitle')}</h1>
      <StatusBadge tone={data.status === 'draft' ? 'neutral' : 'success'} label={statusLabel} />

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
    </div>
  );
}

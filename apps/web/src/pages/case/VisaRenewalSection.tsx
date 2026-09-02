import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { startVisaRenewalRequestSchema, type StartVisaRenewalRequest } from '@caredesk/schemas';
import { Alert, Button, EmptyState, Skeleton, StatusBadge, TextField } from '@caredesk/ui';
import {
  ApiRequestError,
  listVisaRenewals,
  startVisaRenewal,
  type VisaRenewalWorkflowResponse,
} from '../../api/client.js';
import { newIdempotencyKey } from '../../api/idempotency.js';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded'; workflows: VisaRenewalWorkflowResponse[] }
  | { kind: 'unauthorized' }
  | { kind: 'error' };

type StartFields = {
  templateVersionId: string;
  currentAuthorizationId: string;
  asOf: string;
  stepKey: string;
  responsibleId: string;
  accountableId: string;
};

const uuidMessage = 'visaRenewal.invalidIdentifier';

function badgeTone(status: string): 'success' | 'warning' | 'neutral' | 'danger' {
  if (status === 'completed' || status === 'active') return 'success';
  if (status === 'blocked' || status === 'unverified' || status === 'conflicting') return 'warning';
  if (status === 'cancelled' || status === 'unavailable') return 'danger';
  return 'neutral';
}

export function VisaRenewalSection({ caseId }: { caseId: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [startError, setStartError] = useState<
    'conflict' | 'unverified' | 'unauthorized' | 'error'
  >();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<StartFields>({
    resolver: zodResolver(
      startVisaRenewalRequestSchema.omit({ assignments: true }).extend({
        stepKey: startVisaRenewalRequestSchema.shape.assignments.element.shape.stepKey,
        responsibleId: startVisaRenewalRequestSchema.shape.assignments.element.shape.assigneeId,
        accountableId: startVisaRenewalRequestSchema.shape.assignments.element.shape.assigneeId,
      }),
    ),
    defaultValues: { asOf: today, stepKey: 'application_preparation' },
  });

  // Defect: `startVisaRenewal` used to mint a fresh idempotency key inside
  // the function, so a lost response followed by the user pressing "start"
  // again sent a *different* key and the server created a second workflow.
  // The key is now generated here, once per distinct set of form inputs, and
  // reused across retries of the same attempt (a submit that fails leaves
  // these fields unchanged, so the memoized key survives to the next click);
  // it only changes once the user actually edits a field, which is correctly
  // a new logical attempt.
  const [
    templateVersionId,
    currentAuthorizationId,
    asOfField,
    stepKeyField,
    responsibleId,
    accountableId,
  ] = watch([
    'templateVersionId',
    'currentAuthorizationId',
    'asOf',
    'stepKey',
    'responsibleId',
    'accountableId',
  ]);
  const startIdempotencyKey = useMemo(
    () => newIdempotencyKey(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: newIdempotencyKey() doesn't read these values, but together they define "the same logical start attempt" for retry-safety.
    [
      templateVersionId,
      currentAuthorizationId,
      asOfField,
      stepKeyField,
      responsibleId,
      accountableId,
    ],
  );

  const load = useCallback(() => {
    setState({ kind: 'loading' });
    listVisaRenewals(caseId)
      .then((workflows) => setState({ kind: 'loaded', workflows }))
      .catch((error: unknown) => {
        setState(
          error instanceof ApiRequestError && (error.status === 401 || error.status === 403)
            ? { kind: 'unauthorized' }
            : { kind: 'error' },
        );
      });
  }, [caseId]);

  useEffect(load, [load]);

  const submit = handleSubmit(async (fields) => {
    setStartError(undefined);
    const assignments: StartVisaRenewalRequest['assignments'] = [
      {
        stepKey: fields.stepKey,
        raciRole: 'responsible',
        assigneeType: 'user',
        assigneeId: fields.responsibleId,
      },
      {
        stepKey: fields.stepKey,
        raciRole: 'accountable',
        assigneeType: 'user',
        assigneeId: fields.accountableId,
      },
    ];
    try {
      await startVisaRenewal(caseId, { ...fields, assignments }, startIdempotencyKey);
      load();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 409) setStartError('conflict');
        else if (error.code === 'RULE_UNVERIFIED') setStartError('unverified');
        else if (error.status === 401 || error.status === 403) setStartError('unauthorized');
        else setStartError('error');
      } else setStartError('error');
    }
  });

  return (
    <section className="visa-renewal" aria-labelledby="visa-renewal-heading">
      <header className="visa-renewal__header">
        <div>
          <p className="visa-renewal__eyebrow">{t('visaRenewal.eyebrow')}</p>
          <h2 id="visa-renewal-heading">{t('visaRenewal.heading')}</h2>
        </div>
      </header>
      {/* Renewal steps, blockers and review dates are engine output; the caveat
          is stated once, above every workflow card it applies to. */}
      <p className="legal-note">{t('liability.reminder')}</p>
      {state.kind === 'loading' ? (
        <Skeleton loadingLabel={t('visaRenewal.loading')} height="8rem" />
      ) : null}
      {state.kind === 'unauthorized' ? (
        <Alert variant="warning" title={t('visaRenewal.unauthorized')} />
      ) : null}
      {state.kind === 'error' ? (
        <Alert variant="error" title={t('visaRenewal.loadFailed')}>
          <Button variant="secondary" size="sm" onClick={load}>
            {t('visaRenewal.retry')}
          </Button>
        </Alert>
      ) : null}
      {state.kind === 'loaded' && state.workflows.length === 0 ? (
        <EmptyState title={t('visaRenewal.emptyTitle')} body={t('visaRenewal.emptyBody')} />
      ) : null}
      {state.kind === 'loaded'
        ? state.workflows.map((workflow) => {
            const currentStep = workflow.blockers[0]?.stepKey ?? workflow.assignments[0]?.stepKey;
            return (
              <article
                className="visa-workflow-card"
                key={workflow.id}
                aria-label={t('visaRenewal.workflowLabel')}
              >
                <div className="visa-workflow-card__title">
                  <h3>{t('visaRenewal.workflowTitle')}</h3>
                  <StatusBadge
                    tone={badgeTone(workflow.status)}
                    label={t(`visaRenewal.status.${workflow.status}`)}
                  />
                </div>
                <dl className="visa-workflow-summary">
                  <div>
                    <dt>{t('visaRenewal.currentStep')}</dt>
                    <dd>
                      <span dir="ltr">{currentStep ?? t('visaRenewal.notAvailable')}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>{t('visaRenewal.ruleStatus')}</dt>
                    <dd>
                      <StatusBadge
                        tone={badgeTone(workflow.evaluation.status)}
                        label={t(`visaRenewal.rule.${workflow.evaluation.status}`)}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>{t('visaRenewal.evidence')}</dt>
                    <dd>
                      {workflow.evaluation.sourceReferences.length
                        ? t('visaRenewal.evidenceVerified', {
                            count: workflow.evaluation.sourceReferences.length,
                          })
                        : t('visaRenewal.evidenceMissing')}
                    </dd>
                  </div>
                </dl>
                {workflow.evaluation.reviewRequired ? (
                  <Alert variant="warning" title={t('visaRenewal.reviewRequired')} />
                ) : null}
                <h4>{t('visaRenewal.blockers')}</h4>
                {workflow.blockers.length ? (
                  <ul>
                    {workflow.blockers.map((blocker, index) => (
                      <li key={`${blocker.code}-${index}`}>
                        {t(`visaRenewal.blocker.${blocker.code}`)} —{' '}
                        <span dir="ltr">{blocker.stepKey}</span>
                        {blocker.nextReviewAt ? (
                          <>
                            {' '}
                            · {t('visaRenewal.nextReview')}{' '}
                            <span dir="ltr">{blocker.nextReviewAt.slice(0, 10)}</span>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{t('visaRenewal.noBlockers')}</p>
                )}
                <h4>{t('visaRenewal.assignments')}</h4>
                <ul>
                  {workflow.assignments.map((assignment, index) => (
                    <li key={`${assignment.stepKey}-${assignment.raciRole}-${index}`}>
                      <strong>{t(`visaRenewal.raci.${assignment.raciRole}`)}</strong> ·{' '}
                      <span dir="ltr">{assignment.stepKey}</span> ·{' '}
                      <span className="visa-id" dir="ltr">
                        {assignment.assigneeId}
                      </span>
                    </li>
                  ))}
                </ul>
                <h4>{t('visaRenewal.renewedAuthorization')}</h4>
                <p>
                  {workflow.linkedRenewedAuthorizationId ? (
                    <>
                      <span>{t('visaRenewal.linked')}</span>{' '}
                      <span className="visa-id" dir="ltr">
                        {workflow.linkedRenewedAuthorizationId}
                      </span>
                      {workflow.linkedDocumentVersionId ? (
                        <>
                          {' '}
                          · {t('visaRenewal.document')}{' '}
                          <span className="visa-id" dir="ltr">
                            {workflow.linkedDocumentVersionId}
                          </span>
                        </>
                      ) : null}
                    </>
                  ) : (
                    t('visaRenewal.notLinked')
                  )}
                </p>
              </article>
            );
          })
        : null}
      {state.kind === 'loaded' ? (
        <details className="visa-renewal-start">
          <summary>{t('visaRenewal.startHeading')}</summary>
          <p>{t('visaRenewal.startHelp')}</p>
          {startError ? (
            <Alert
              variant={startError === 'error' ? 'error' : 'warning'}
              title={t(`visaRenewal.startError.${startError}`)}
            />
          ) : null}
          <form onSubmit={(event) => void submit(event)} noValidate>
            <TextField
              label={t('visaRenewal.templateVersion')}
              inputDir="ltr"
              required
              error={errors.templateVersionId ? t(uuidMessage) : undefined}
              {...register('templateVersionId')}
            />
            <TextField
              label={t('visaRenewal.currentAuthorization')}
              inputDir="ltr"
              required
              error={errors.currentAuthorizationId ? t(uuidMessage) : undefined}
              {...register('currentAuthorizationId')}
            />
            <TextField
              label={t('visaRenewal.asOf')}
              type="date"
              inputDir="ltr"
              required
              error={errors.asOf ? t('visaRenewal.invalidDate') : undefined}
              {...register('asOf')}
            />
            <TextField
              label={t('visaRenewal.stepKey')}
              inputDir="ltr"
              required
              error={errors.stepKey ? t('case.fieldRequired') : undefined}
              {...register('stepKey')}
            />
            <TextField
              label={t('visaRenewal.responsible')}
              inputDir="ltr"
              required
              error={errors.responsibleId ? t(uuidMessage) : undefined}
              {...register('responsibleId')}
            />
            <TextField
              label={t('visaRenewal.accountable')}
              inputDir="ltr"
              required
              error={errors.accountableId ? t(uuidMessage) : undefined}
              {...register('accountableId')}
            />
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('visaRenewal.starting') : t('visaRenewal.start')}
            </Button>
          </form>
        </details>
      ) : null}
    </section>
  );
}

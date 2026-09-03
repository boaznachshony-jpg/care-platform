import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { startVisaRenewalRequestSchema, type StartVisaRenewalRequest } from '@caredesk/schemas';
import {
  Alert,
  Button,
  EmptyState,
  SelectField,
  Skeleton,
  StatusBadge,
  TextField,
} from '@caredesk/ui';
import {
  ApiRequestError,
  listCaseAuthorizations,
  listCaseCollaborationMembers,
  listVisaRenewals,
  listWorkflowTemplates,
  startVisaRenewal,
  type CaseAuthorizationOptionResponse,
  type CaseCollaborationMemberResponse,
  type VisaRenewalWorkflowResponse,
  type WorkflowTemplateOptionResponse,
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

const selectionRequiredMessage = 'visaRenewal.selectionRequired';

// Each source the "start" form needs is fetched independently (own
// loading/error state) so one slow or failing list never blocks the others
// — see PickerState usage below. `loading` and `error` do not need to carry
// the item type; only `loaded` does.
type PickerState<T> = { kind: 'loading' } | { kind: 'loaded'; items: T[] } | { kind: 'error' };

/**
 * Resolves what the "start a renewal" form can show, in priority order: a
 * still-loading source blocks everything, then a failed fetch, then each
 * "nothing here yet" case in turn (Constitution: an empty picker must say
 * what to do about it, never look like a broken form). Only when every
 * source has real options does the form itself render.
 */
type StartGate =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'noTemplates' }
  | { kind: 'noAuthorizations' }
  | { kind: 'noMembers' }
  | {
      kind: 'ready';
      templates: WorkflowTemplateOptionResponse[];
      authorizations: CaseAuthorizationOptionResponse[];
      members: CaseCollaborationMemberResponse[];
    };

function computeStartGate(
  templates: PickerState<WorkflowTemplateOptionResponse>,
  authorizations: PickerState<CaseAuthorizationOptionResponse>,
  members: PickerState<CaseCollaborationMemberResponse>,
): StartGate {
  if (
    templates.kind === 'loading' ||
    authorizations.kind === 'loading' ||
    members.kind === 'loading'
  )
    return { kind: 'loading' };
  if (templates.kind === 'error' || authorizations.kind === 'error' || members.kind === 'error')
    return { kind: 'error' };
  if (templates.items.length === 0) return { kind: 'noTemplates' };
  if (authorizations.items.length === 0) return { kind: 'noAuthorizations' };
  if (members.items.length === 0) return { kind: 'noMembers' };
  return {
    kind: 'ready',
    templates: templates.items,
    authorizations: authorizations.items,
    members: members.items,
  };
}

function badgeTone(status: string): 'success' | 'warning' | 'neutral' | 'danger' {
  if (status === 'completed' || status === 'active') return 'success';
  if (status === 'blocked' || status === 'unverified' || status === 'conflicting') return 'warning';
  if (status === 'cancelled' || status === 'unavailable') return 'danger';
  return 'neutral';
}

/** A recognisable label for one employment_authorization row — status and validity dates, never the id. */
function authorizationLabel(
  authorization: CaseAuthorizationOptionResponse,
  t: (key: string) => string,
): string {
  const status = t(`visaRenewal.authorizationStatus.${authorization.status}`);
  const from = authorization.validFrom ?? t('visaRenewal.dateUnknown');
  const until = authorization.validUntil ?? t('visaRenewal.dateUnknown');
  return `${status} · ${from} – ${until}`;
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
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<StartFields>({
    resolver: zodResolver(
      startVisaRenewalRequestSchema.omit({ assignments: true }).extend({
        stepKey: startVisaRenewalRequestSchema.shape.assignments.element.shape.stepKey,
        responsibleId: startVisaRenewalRequestSchema.shape.assignments.element.shape.assigneeId,
        accountableId: startVisaRenewalRequestSchema.shape.assignments.element.shape.assigneeId,
      }),
    ),
    // stepKey has no safe hardcoded default any more (see ListWorkflowTemplates
    // research: the previous 'application_preparation' literal matched no real
    // template step). It is set once the chosen template's own steps are known
    // — see the effect below.
    defaultValues: { asOf: today },
  });

  const [templatesState, setTemplatesState] = useState<PickerState<WorkflowTemplateOptionResponse>>(
    { kind: 'loading' },
  );
  const [authorizationsState, setAuthorizationsState] = useState<
    PickerState<CaseAuthorizationOptionResponse>
  >({ kind: 'loading' });
  const [membersState, setMembersState] = useState<PickerState<CaseCollaborationMemberResponse>>({
    kind: 'loading',
  });

  const loadTemplates = useCallback(() => {
    setTemplatesState({ kind: 'loading' });
    listWorkflowTemplates()
      .then((items) => setTemplatesState({ kind: 'loaded', items }))
      .catch(() => setTemplatesState({ kind: 'error' }));
  }, []);
  const loadAuthorizations = useCallback(() => {
    setAuthorizationsState({ kind: 'loading' });
    listCaseAuthorizations(caseId)
      .then((items) => setAuthorizationsState({ kind: 'loaded', items }))
      .catch(() => setAuthorizationsState({ kind: 'error' }));
  }, [caseId]);
  const loadMembers = useCallback(() => {
    setMembersState({ kind: 'loading' });
    listCaseCollaborationMembers(caseId)
      .then(({ members }) => setMembersState({ kind: 'loaded', items: members }))
      .catch(() => setMembersState({ kind: 'error' }));
  }, [caseId]);
  const loadStartPickers = useCallback(() => {
    loadTemplates();
    loadAuthorizations();
    loadMembers();
  }, [loadTemplates, loadAuthorizations, loadMembers]);

  useEffect(loadTemplates, [loadTemplates]);
  useEffect(loadAuthorizations, [loadAuthorizations]);
  useEffect(loadMembers, [loadMembers]);

  const startGate = computeStartGate(templatesState, authorizationsState, membersState);

  // Only the two the default-selection effect below needs to observe. The
  // idempotency key used to be memoized over all six, which is why they were
  // all watched; it is now derived from the values actually being submitted
  // (see `idempotencyKeyFor`), so watching the rest only caused re-renders.
  const [templateVersionId, stepKeyField] = watch(['templateVersionId', 'stepKey']);
  /**
   * One key per set of answers, decided at submit time rather than at render
   * time.
   *
   * `useMemo` over the field values looked equivalent and was not: the pickers
   * populate their defaults through effects, so a value could still settle
   * between the first press and the retry, mint a second key, and let the
   * server create a second renewal from what the customer experienced as one
   * button pressed twice. Comparing a signature of the answers actually being
   * submitted has no such window — the same answers always produce the same
   * key, and changed answers are a genuinely new attempt.
   */
  const startAttemptRef = useRef<{ signature: string; key: string } | null>(null);
  const idempotencyKeyFor = (signature: string): string => {
    if (startAttemptRef.current?.signature !== signature) {
      startAttemptRef.current = { signature, key: newIdempotencyKey() };
    }
    return startAttemptRef.current.key;
  };

  // Keeps `templateVersionId` and `stepKey` pointed at a real, currently
  // selected template's own step: defaults both to the first option once the
  // template list loads, and re-picks `stepKey` whenever the chosen template
  // changes to a version whose steps don't include the previous value. This
  // is what replaces the old hardcoded, unverifiable stepKey default.
  useEffect(() => {
    if (startGate.kind !== 'ready') return;
    const selected = startGate.templates.find((tpl) => tpl.templateVersionId === templateVersionId);
    const template = selected ?? startGate.templates[0];
    if (!template) return;
    if (!selected) setValue('templateVersionId', template.templateVersionId);
    const steps = [...template.steps].sort((a, b) => a.position - b.position);
    if (!steps.some((step) => step.stepKey === stepKeyField)) {
      const firstStep = steps[0];
      if (firstStep) setValue('stepKey', firstStep.stepKey);
    }
  }, [startGate, templateVersionId, stepKeyField, setValue]);

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
      await startVisaRenewal(
        caseId,
        { ...fields, assignments },
        idempotencyKeyFor(JSON.stringify(fields)),
      );
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
          {startGate.kind === 'loading' ? (
            <Skeleton loadingLabel={t('visaRenewal.startLoading')} height="12rem" />
          ) : null}
          {startGate.kind === 'error' ? (
            <Alert variant="error" title={t('visaRenewal.startLoadFailed')}>
              <Button variant="secondary" size="sm" onClick={loadStartPickers}>
                {t('visaRenewal.retry')}
              </Button>
            </Alert>
          ) : null}
          {startGate.kind === 'noTemplates' ? (
            <EmptyState
              title={t('visaRenewal.noTemplatesTitle')}
              body={t('visaRenewal.noTemplatesBody')}
            />
          ) : null}
          {startGate.kind === 'noAuthorizations' ? (
            <EmptyState
              title={t('visaRenewal.noAuthorizationsTitle')}
              body={t('visaRenewal.noAuthorizationsBody')}
            />
          ) : null}
          {startGate.kind === 'noMembers' ? (
            <EmptyState
              title={t('visaRenewal.noMembersTitle')}
              body={t('visaRenewal.noMembersBody')}
            />
          ) : null}
          {startGate.kind === 'ready' ? (
            <form onSubmit={(event) => void submit(event)} noValidate>
              <SelectField
                label={t('visaRenewal.templateVersion')}
                required
                options={startGate.templates.map((template) => ({
                  value: template.templateVersionId,
                  label: `${t(template.nameKey, { defaultValue: template.templateKey })} · v${template.version}`,
                }))}
                error={errors.templateVersionId ? t(selectionRequiredMessage) : undefined}
                {...register('templateVersionId')}
              />
              <SelectField
                label={t('visaRenewal.stepKey')}
                required
                options={(
                  startGate.templates.find((tpl) => tpl.templateVersionId === templateVersionId)
                    ?.steps ??
                  startGate.templates[0]?.steps ??
                  []
                )
                  .slice()
                  .sort((a, b) => a.position - b.position)
                  .map((step) => ({
                    value: step.stepKey,
                    label: t(step.titleKey, { defaultValue: step.stepKey }),
                  }))}
                error={errors.stepKey ? t(selectionRequiredMessage) : undefined}
                {...register('stepKey')}
              />
              <SelectField
                label={t('visaRenewal.currentAuthorization')}
                required
                options={startGate.authorizations.map((authorization) => ({
                  value: authorization.id,
                  label: authorizationLabel(authorization, t),
                }))}
                error={errors.currentAuthorizationId ? t(selectionRequiredMessage) : undefined}
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
              <SelectField
                label={t('visaRenewal.responsible')}
                required
                options={startGate.members.map((member) => ({
                  value: member.id,
                  label: member.display_name,
                }))}
                error={errors.responsibleId ? t(selectionRequiredMessage) : undefined}
                {...register('responsibleId')}
              />
              <SelectField
                label={t('visaRenewal.accountable')}
                required
                options={startGate.members.map((member) => ({
                  value: member.id,
                  label: member.display_name,
                }))}
                error={errors.accountableId ? t(selectionRequiredMessage) : undefined}
                {...register('accountableId')}
              />
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t('visaRenewal.starting') : t('visaRenewal.start')}
              </Button>
            </form>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}

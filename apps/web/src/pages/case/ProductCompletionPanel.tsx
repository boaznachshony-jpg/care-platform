import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@caredesk/ui';
import { useTranslation } from 'react-i18next';
import {
  askCaseAssistant,
  confirmAssistantChecklist,
  createProfessionalReview,
  getCaseHealth,
  getProfessionalReview,
  listProfessionalReviews,
  transitionProfessionalReview,
  type AssistantResponse as ApiAssistantResponse,
  type CaseHealthResponse,
  type ProfessionalReviewResponse,
  type ProfessionalReviewStatus,
  type ProfessionalReviewTransitionResponse,
} from '../../api/client.js';
import { newIdempotencyKey } from '../../api/idempotency.js';
import { formatDateTime, toIsoAttribute } from '../../format-timestamp.js';
import {
  healthFactorAction,
  healthFactorExplanation,
  healthFactorTitle,
} from '../../health-factors.js';

/**
 * Mirror of the server-side lifecycle. The server is authoritative — this map
 * only decides which buttons to render. Assignment is a manual handoff to a
 * professional named by the manager; CareDesk never contacts a provider.
 */
const ESCALATION_TRANSITIONS: Record<ProfessionalReviewStatus, ProfessionalReviewStatus[]> = {
  requested: ['acknowledged', 'cancelled'],
  acknowledged: ['in_review', 'cancelled'],
  in_review: ['resolved', 'cancelled'],
  resolved: [],
  cancelled: [],
};

/**
 * apps/web/src/api/client.ts (owned by another workstream — not edited here)
 * does not yet declare the `*Id`/`*Params` identifier fields the assistant
 * route now sends. The server already puts them on the wire at runtime; this
 * local extension lets the panel read them without waiting for client.ts to
 * catch up. Same contract as ../../health-factors.ts throughout: the server
 * decides the identifier, the locale decides the wording, and a missing or
 * unrecognised identifier falls back to the server's own text so a new
 * message is never invisible.
 */
interface AssistantResponse extends Omit<ApiAssistantResponse, 'factsUsed' | 'escalation'> {
  answerId?: string;
  answerParams?: Record<string, unknown>;
  groundingLabelId?: string;
  factsUsed: Array<{
    factPath: string;
    label: string;
    labelId?: string;
    labelParams?: Record<string, unknown>;
  }>;
  escalation?: { required: boolean; reason: string; reasonId?: string };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

type WriteState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * One idempotency key per logical attempt (the VisaRenewalSection pattern):
 * the same payload keeps the same key so a lost response plus a second press
 * is replayed by the server instead of duplicated; a changed payload is a new
 * attempt and gets a new key. Callers clear the ref after success so a later,
 * deliberate repeat of the same request is not swallowed as a replay.
 */
type WriteAttempt = { signature: string; key: string } | null;
function keyForAttempt(ref: { current: WriteAttempt }, signature: string): string {
  if (ref.current?.signature !== signature) {
    ref.current = { signature, key: newIdempotencyKey() };
  }
  return ref.current.key;
}

function translateOrFallback(
  t: Translate,
  key: string | undefined,
  fallback: string,
  params?: Record<string, unknown>,
): string {
  if (!key) return fallback;
  const translated = t(key, params);
  return translated === key ? fallback : translated;
}

function assistantAnswerText(answer: AssistantResponse, t: Translate): string {
  if (answer.answerId === 'assistant.answer.missingDocuments') {
    const missingTypes = (answer.answerParams?.missingTypes as string[] | undefined) ?? [];
    const types = missingTypes
      .map((type) => translateOrFallback(t, `assistant.documentType.${type}`, type))
      .join(', ');
    return translateOrFallback(t, answer.answerId, answer.answer, { types });
  }
  return translateOrFallback(t, answer.answerId, answer.answer, answer.answerParams);
}

function assistantGroundingLabel(answer: AssistantResponse, t: Translate): string {
  return translateOrFallback(t, answer.groundingLabelId, answer.groundingLabel);
}

function assistantFactLabel(fact: AssistantResponse['factsUsed'][number], t: Translate): string {
  if (fact.labelId === 'assistant.fact.caseStatus') {
    const status = String(fact.labelParams?.status ?? '');
    return translateOrFallback(t, fact.labelId, fact.label, {
      status: translateOrFallback(t, `assistant.caseStatus.${status}`, status),
    });
  }
  return translateOrFallback(t, fact.labelId, fact.label, fact.labelParams);
}

function assistantUncertaintyMessage(
  item: AssistantResponse['uncertainties'][number],
  t: Translate,
): string {
  return translateOrFallback(t, `assistant.uncertainty.${item.code}`, item.message);
}

function assistantEscalationReason(
  escalation: AssistantResponse['escalation'],
  t: Translate,
): string | undefined {
  if (!escalation) return undefined;
  return translateOrFallback(t, escalation.reasonId, escalation.reason);
}

export function ProductCompletionPanel({ caseId }: { caseId: string }) {
  const { t } = useTranslation();
  const [health, setHealth] = useState<CaseHealthResponse>();
  const [healthError, setHealthError] = useState(false);
  const [reviews, setReviews] = useState<ProfessionalReviewResponse[]>([]);
  const [reviewsError, setReviewsError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AssistantResponse>();
  const [busy, setBusy] = useState(false);
  // UI-STATES-08: a rejected question used to leave the button re-enabled and
  // nothing else — indistinguishable from "the assistant had no answer".
  const [askError, setAskError] = useState(false);
  // UI-WRITE-03: "create tasks" was fire-and-forget — no await, no catch, no
  // lock, a fresh key per click — so every press created the checklist's tasks
  // again and a failure was invisible.
  const [checklistState, setChecklistState] = useState<WriteState>('idle');
  const checklistInFlight = useRef(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: newIdempotencyKey() reads nothing, but the proposed checklist is what defines "the same logical plan" for retry-safety (AutomationPanel pattern).
  const checklistKey = useMemo(() => newIdempotencyKey(), [answer?.proposedChecklist]);
  const escalateAttempt = useRef<WriteAttempt>(null);
  const transitionAttempt = useRef<WriteAttempt>(null);
  useEffect(() => {
    // The two calls are independent (case health vs. review list), so one
    // failing must not hide the other, and a retry (loadAttempt) must not
    // apply stale state from a request that is still in flight for a caseId
    // the user has since navigated away from.
    let cancelled = false;
    setHealthError(false);
    setReviewsError(false);
    getCaseHealth(caseId)
      .then((result) => {
        if (!cancelled) setHealth(result);
      })
      .catch(() => {
        if (!cancelled) setHealthError(true);
      });
    listProfessionalReviews(caseId)
      .then((result) => {
        if (!cancelled) setReviews(result);
      })
      .catch(() => {
        if (!cancelled) setReviewsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, loadAttempt]);
  async function ask() {
    setBusy(true);
    setAskError(false);
    try {
      setAnswer(
        await askCaseAssistant(
          caseId,
          question,
          question.includes('travel') ? 'travel_check' : 'checklist',
        ),
      );
      // A new answer is a new proposed checklist; the previous confirmation's
      // saved/error state no longer describes it.
      setChecklistState('idle');
    } catch {
      setAskError(true);
    } finally {
      setBusy(false);
    }
  }
  async function confirmChecklist(items: string[]) {
    // The ref, not the state, is the lock: two clicks in the same tick both
    // see `checklistState === 'idle'` because the re-render has not happened.
    if (checklistInFlight.current) return;
    checklistInFlight.current = true;
    setChecklistState('saving');
    try {
      await confirmAssistantChecklist(caseId, items, checklistKey);
      setChecklistState('saved');
      // The task list is rendered by CaseTasksSection, which owns its own
      // fetch; this announces that tasks were created so that section can
      // refetch once it subscribes to the event (not wired in this change).
      window.dispatchEvent(new CustomEvent('caredesk:case-tasks-changed', { detail: { caseId } }));
    } catch {
      setChecklistState('error');
    } finally {
      checklistInFlight.current = false;
    }
  }
  const [escalateError, setEscalateError] = useState(false);
  async function escalate() {
    setEscalateError(false);
    setBusy(true);
    try {
      const input = {
        category: 'general',
        reason: assistantEscalationReason(answer?.escalation, t) ?? t('completion.reviewReason'),
        summary: t('completion.reviewSummary'),
        source: answer ? 'case_ai' : 'manual',
      };
      const row = await createProfessionalReview(
        caseId,
        input,
        keyForAttempt(escalateAttempt, JSON.stringify(input)),
      );
      escalateAttempt.current = null;
      setReviews((current) => [row, ...current]);
    } catch {
      // No confirmation on failure looked identical to "it worked" — an
      // escalation request is exactly the case where that silence is unsafe.
      setEscalateError(true);
    } finally {
      setBusy(false);
    }
  }
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [histories, setHistories] = useState<
    Record<string, ProfessionalReviewTransitionResponse[]>
  >({});
  const [historyErrors, setHistoryErrors] = useState<Record<string, boolean>>({});
  const [transitionError, setTransitionError] = useState(false);
  async function transition(review: ProfessionalReviewResponse, status: ProfessionalReviewStatus) {
    setTransitionError(false);
    setBusy(true);
    try {
      const assignedTo = assignments[review.id]?.trim();
      const resolutionNote = notes[review.id]?.trim();
      const input = {
        status,
        ...(assignedTo ? { assignedTo } : {}),
        ...(status === 'resolved' && resolutionNote ? { resolutionNote } : {}),
      };
      const updated = await transitionProfessionalReview(
        caseId,
        review.id,
        input,
        keyForAttempt(transitionAttempt, JSON.stringify({ reviewId: review.id, ...input })),
      );
      transitionAttempt.current = null;
      setReviews((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setHistories((current) => ({ ...current, [review.id]: [] }));
    } catch {
      setTransitionError(true);
    } finally {
      setBusy(false);
    }
  }
  async function loadHistory(reviewId: string) {
    setHistoryErrors((current) => ({ ...current, [reviewId]: false }));
    try {
      const detail = await getProfessionalReview(caseId, reviewId);
      setHistories((current) => ({ ...current, [reviewId]: detail.history }));
    } catch {
      // A failed load must not render as "no history yet" — that is exactly
      // what a genuinely empty, and therefore reassuring, audit trail looks
      // like.
      setHistoryErrors((current) => ({ ...current, [reviewId]: true }));
    }
  }
  return (
    <section className="card completion-panel" aria-labelledby="case-health-title">
      <h2 id="case-health-title">{t('completion.health')}</h2>
      {health ? (
        <>
          <p className="completion-score" dir="ltr">
            <strong>{health.score}</strong> / 100
          </p>
          <p>{t('completion.disclaimer')}</p>
          <ul>
            {health.factors.map((factor) => (
              <li key={factor.id}>
                <strong>
                  {factor.status === 'good' ? '✓' : '!'} {healthFactorTitle(factor, t)}
                </strong>{' '}
                — {healthFactorExplanation(factor, t)}{' '}
                <small>
                  {factor.points}/{factor.weight}
                </small>
                {factor.actionTarget && healthFactorAction(factor, t) ? (
                  // The separator is not cosmetic: without it the score and the
                  // link ran together as "0/25Upload or review the document".
                  <>
                    {' · '}
                    <a href={factor.actionTarget}>{healthFactorAction(factor, t)}</a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          <strong>{t('completion.actionsRemaining', { count: health.actionsRemaining })}</strong>
        </>
      ) : healthError ? (
        <p role="alert">
          {t('completion.healthLoadFailed')}{' '}
          <Button variant="secondary" onClick={() => setLoadAttempt((current) => current + 1)}>
            {t('completion.retry')}
          </Button>
        </p>
      ) : (
        <p role="status">{t('shell.loading')}</p>
      )}
      <hr />
      <h2>{t('completion.assistant')}</h2>
      <label>
        {t('completion.question')}
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} />
      </label>
      <Button disabled={busy || question.trim().length < 3} onClick={() => void ask()}>
        {t('completion.ask')}
      </Button>
      {askError ? <p role="alert">{t('completion.askFailed')}</p> : null}
      {answer ? (
        <article aria-label={t('completion.aiLabel')}>
          <strong>{assistantGroundingLabel(answer, t)}</strong>
          <p>{assistantAnswerText(answer, t)}</p>
          <details>
            <summary>{t('completion.facts')}</summary>
            <ul>
              {answer.factsUsed.map((fact) => (
                <li key={fact.factPath}>{assistantFactLabel(fact, t)}</li>
              ))}
            </ul>
          </details>
          {answer.uncertainties.map((item) => (
            <p role="status" key={item.code}>
              {assistantUncertaintyMessage(item, t)}
            </p>
          ))}
          {answer.proposedChecklist ? (
            <>
              <Button
                disabled={checklistState === 'saving' || checklistState === 'saved'}
                aria-busy={checklistState === 'saving' || undefined}
                onClick={() => void confirmChecklist(answer.proposedChecklist!)}
              >
                {t('completion.createTasks')}
              </Button>
              {checklistState === 'saving' ? (
                <p role="status">{t('completion.checklistSaving')}</p>
              ) : null}
              {checklistState === 'saved' ? (
                <p role="status">{t('completion.checklistSaved')}</p>
              ) : null}
              {checklistState === 'error' ? (
                <p role="alert">{t('completion.checklistFailed')}</p>
              ) : null}
            </>
          ) : null}
          <Button variant="secondary" disabled={busy} onClick={() => void escalate()}>
            {t('completion.createReview')}
          </Button>
        </article>
      ) : null}
      <hr />
      <h2>{t('completion.reviews')}</h2>
      <p>
        <small>{t('escalation.manualHandoffDisclaimer')}</small>
      </p>
      {escalateError ? <p role="alert">{t('completion.escalateFailed')}</p> : null}
      {transitionError ? <p role="alert">{t('escalation.transitionFailed')}</p> : null}
      {reviewsError ? (
        <p role="alert">
          {t('completion.reviewsLoadFailed')}{' '}
          <Button variant="secondary" onClick={() => setLoadAttempt((current) => current + 1)}>
            {t('completion.retry')}
          </Button>
        </p>
      ) : reviews.length ? (
        <ul>
          {reviews.map((review) => (
            <li key={review.id}>
              <strong className="escalation-status" data-status={review.status}>
                {t(`escalation.status.${review.status}`)}
              </strong>{' '}
              — {review.reason}
              <small className="record-timestamp">
                {toIsoAttribute(review.createdAt) ? (
                  <>
                    {t('escalation.openedAt')}{' '}
                    <time dateTime={toIsoAttribute(review.createdAt) ?? undefined}>
                      {formatDateTime(review.createdAt)}
                    </time>
                  </>
                ) : null}
                {toIsoAttribute(review.resolvedAt) ? (
                  <>
                    {' · '}
                    {t('escalation.resolvedAt')}{' '}
                    <time dateTime={toIsoAttribute(review.resolvedAt) ?? undefined}>
                      {formatDateTime(review.resolvedAt)}
                    </time>
                  </>
                ) : null}
              </small>
              {review.assignedTo ? (
                <p>
                  {t('escalation.assignedToDisplay')}: {review.assignedTo}{' '}
                  <small>({t('escalation.manualHandoff')})</small>
                </p>
              ) : null}
              {review.resolutionNote ? (
                <p>
                  {t('escalation.resolutionNoteDisplay')}: {review.resolutionNote}
                </p>
              ) : null}
              {ESCALATION_TRANSITIONS[review.status].length ? (
                <div className="escalation-actions">
                  <label>
                    {t('escalation.assignedToLabel')}
                    <input
                      value={assignments[review.id] ?? ''}
                      onChange={(event) =>
                        setAssignments((current) => ({
                          ...current,
                          [review.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  {ESCALATION_TRANSITIONS[review.status].includes('resolved') ? (
                    <label>
                      {t('escalation.resolutionNoteLabel')}
                      <textarea
                        value={notes[review.id] ?? ''}
                        onChange={(event) =>
                          setNotes((current) => ({ ...current, [review.id]: event.target.value }))
                        }
                      />
                    </label>
                  ) : null}
                  {ESCALATION_TRANSITIONS[review.status].map((next) => (
                    <Button
                      key={next}
                      variant="secondary"
                      disabled={
                        busy || (next === 'resolved' && (notes[review.id]?.trim().length ?? 0) < 3)
                      }
                      onClick={() => void transition(review, next)}
                    >
                      {t(`escalation.transition.${next}`)}
                    </Button>
                  ))}
                </div>
              ) : null}
              <details
                onToggle={(event) => {
                  if ((event.target as HTMLDetailsElement).open) void loadHistory(review.id);
                }}
              >
                <summary>{t('escalation.history')}</summary>
                {historyErrors[review.id] ? (
                  <p role="alert">
                    {t('completion.historyLoadFailed')}{' '}
                    <Button variant="secondary" onClick={() => void loadHistory(review.id)}>
                      {t('completion.retry')}
                    </Button>
                  </p>
                ) : null}
                <ul>
                  {(histories[review.id] ?? []).map((item) => (
                    <li key={item.id}>
                      {t(`escalation.status.${item.fromStatus}`)} →{' '}
                      {t(`escalation.status.${item.toStatus}`)}
                      {item.assignedTo ? ` · ${item.assignedTo}` : ''}
                      {/* This list is the escalation's audit trail. It carried
                          changedBy and createdAt all along and rendered
                          neither, so it recorded what changed but never who
                          did it or when - the two things an audit trail is
                          for. */}
                      <small className="record-timestamp">
                        {item.changedBy ? `${t('escalation.changedBy')} ${item.changedBy}` : null}
                        {item.changedBy && toIsoAttribute(item.createdAt) ? ' · ' : null}
                        {toIsoAttribute(item.createdAt) ? (
                          <time dateTime={toIsoAttribute(item.createdAt) ?? undefined}>
                            {formatDateTime(item.createdAt)}
                          </time>
                        ) : null}
                      </small>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t('completion.noReviews')}</p>
      )}
      <Button variant="secondary" disabled={busy} onClick={() => void escalate()}>
        {t('completion.manualReview')}
      </Button>
    </section>
  );
}

import { useEffect, useState } from 'react';
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
  type AssistantResponse,
  type CaseHealthResponse,
  type ProfessionalReviewResponse,
  type ProfessionalReviewStatus,
  type ProfessionalReviewTransitionResponse,
} from '../../api/client.js';

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

export function ProductCompletionPanel({ caseId }: { caseId: string }) {
  const { t } = useTranslation();
  const [health, setHealth] = useState<CaseHealthResponse>();
  const [reviews, setReviews] = useState<ProfessionalReviewResponse[]>([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AssistantResponse>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void Promise.all([
      getCaseHealth(caseId).then(setHealth),
      listProfessionalReviews(caseId).then(setReviews),
    ]);
  }, [caseId]);
  async function ask() {
    setBusy(true);
    try {
      setAnswer(
        await askCaseAssistant(
          caseId,
          question,
          question.includes('travel') ? 'travel_check' : 'checklist',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  async function escalate() {
    const row = await createProfessionalReview(caseId, {
      category: 'general',
      reason: answer?.escalation?.reason ?? t('completion.reviewReason'),
      summary: t('completion.reviewSummary'),
      source: answer ? 'case_ai' : 'manual',
    });
    setReviews((current) => [row, ...current]);
  }
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [histories, setHistories] = useState<
    Record<string, ProfessionalReviewTransitionResponse[]>
  >({});
  const [transitionError, setTransitionError] = useState(false);
  async function transition(review: ProfessionalReviewResponse, status: ProfessionalReviewStatus) {
    setTransitionError(false);
    setBusy(true);
    try {
      const assignedTo = assignments[review.id]?.trim();
      const resolutionNote = notes[review.id]?.trim();
      const updated = await transitionProfessionalReview(caseId, review.id, {
        status,
        ...(assignedTo ? { assignedTo } : {}),
        ...(status === 'resolved' && resolutionNote ? { resolutionNote } : {}),
      });
      setReviews((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setHistories((current) => ({ ...current, [review.id]: [] }));
    } catch {
      setTransitionError(true);
    } finally {
      setBusy(false);
    }
  }
  async function loadHistory(reviewId: string) {
    const detail = await getProfessionalReview(caseId, reviewId);
    setHistories((current) => ({ ...current, [reviewId]: detail.history }));
  }
  return (
    <section className="card completion-panel" aria-labelledby="case-health-title">
      <h2 id="case-health-title">{t('completion.health')}</h2>
      {health ? (
        <>
          <p className="completion-score">
            <strong>{health.score}</strong> / 100
          </p>
          <p>{t('completion.disclaimer')}</p>
          <ul>
            {health.factors.map((factor) => (
              <li key={factor.id}>
                <strong>
                  {factor.status === 'good' ? '✓' : '!'} {factor.title}
                </strong>{' '}
                — {factor.explanation}{' '}
                <small>
                  {factor.points}/{factor.weight}
                </small>
                {factor.actionTarget ? (
                  <a href={factor.actionTarget}>{factor.recommendedAction}</a>
                ) : null}
              </li>
            ))}
          </ul>
          <strong>{t('completion.actionsRemaining', { count: health.actionsRemaining })}</strong>
        </>
      ) : (
        <p>{t('shell.loading')}</p>
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
      {answer ? (
        <article aria-label={t('completion.aiLabel')}>
          <strong>{answer.groundingLabel}</strong>
          <p>{answer.answer}</p>
          <details>
            <summary>{t('completion.facts')}</summary>
            <ul>
              {answer.factsUsed.map((fact) => (
                <li key={fact.factPath}>{fact.label}</li>
              ))}
            </ul>
          </details>
          {answer.uncertainties.map((item) => (
            <p role="status" key={item.code}>
              {item.message}
            </p>
          ))}
          {answer.proposedChecklist ? (
            <Button
              onClick={() => void confirmAssistantChecklist(caseId, answer.proposedChecklist!)}
            >
              {t('completion.createTasks')}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => void escalate()}>
            {t('completion.createReview')}
          </Button>
        </article>
      ) : null}
      <hr />
      <h2>{t('completion.reviews')}</h2>
      <p>
        <small>{t('escalation.manualHandoffDisclaimer')}</small>
      </p>
      {transitionError ? <p role="alert">{t('escalation.transitionFailed')}</p> : null}
      {reviews.length ? (
        <ul>
          {reviews.map((review) => (
            <li key={review.id}>
              <strong className="escalation-status" data-status={review.status}>
                {t(`escalation.status.${review.status}`)}
              </strong>{' '}
              — {review.reason}
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
                        busy ||
                        (next === 'resolved' && (notes[review.id]?.trim().length ?? 0) < 3)
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
                <ul>
                  {(histories[review.id] ?? []).map((item) => (
                    <li key={item.id}>
                      {t(`escalation.status.${item.fromStatus}`)} →{' '}
                      {t(`escalation.status.${item.toStatus}`)}
                      {item.assignedTo ? ` · ${item.assignedTo}` : ''}
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
      <Button variant="secondary" onClick={() => void escalate()}>
        {t('completion.manualReview')}
      </Button>
    </section>
  );
}

import { useEffect, useState } from 'react';
import { Button } from '@caredesk/ui';
import { useTranslation } from 'react-i18next';
import {
  askCaseAssistant,
  confirmAssistantChecklist,
  createProfessionalReview,
  getCaseHealth,
  listProfessionalReviews,
  type AssistantResponse,
  type CaseHealthResponse,
  type ProfessionalReviewResponse,
} from '../../api/client.js';

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
      {reviews.length ? (
        <ul>
          {reviews.map((review) => (
            <li key={review.id}>
              <strong>{review.status}</strong> — {review.reason}
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

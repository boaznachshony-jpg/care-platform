import { useEffect, useState, type FormEvent } from 'react';
import { Button, StatusBadge, type StatusTone } from '@caredesk/ui';
import { useTranslation } from 'react-i18next';
import {
  createRegulationRule,
  listRegulationRules,
  transitionRegulationRule,
  type RegulationRuleResponse,
  type RegulationRuleStatus,
} from '../api/client.js';

/**
 * Mirror of the server-side review lifecycle. The server is authoritative —
 * this map only decides which transition buttons to render. Approval records a
 * free-text professional reviewer name (manual review, no provider), and only
 * ACTIVE, effective-dated rules ever feed the assistant/wizard context.
 */
const RULE_TRANSITIONS: Record<RegulationRuleStatus, RegulationRuleStatus[]> = {
  draft: ['in_review'],
  in_review: ['approved'],
  approved: ['active'],
  active: ['retired'],
  retired: [],
};

const TRANSITION_LABEL_KEYS: Record<Exclude<RegulationRuleStatus, 'draft'>, string> = {
  in_review: 'regulation.submitForReview',
  approved: 'regulation.approve',
  active: 'regulation.activate',
  retired: 'regulation.retire',
};

const STATUS_TONES: Record<RegulationRuleStatus, StatusTone> = {
  draft: 'neutral',
  in_review: 'info',
  approved: 'warning',
  active: 'success',
  retired: 'neutral',
};

const EMPTY_DRAFT = {
  ruleKey: '',
  title: '',
  statement: '',
  sourceCitation: '',
  sourceAuthority: '',
  effectiveFrom: '',
};

export function RegulationRulesAdmin() {
  const { t } = useTranslation();
  const [rules, setRules] = useState<RegulationRuleResponse[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transitionError, setTransitionError] = useState(false);
  const [reviewerNames, setReviewerNames] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [createError, setCreateError] = useState(false);

  useEffect(() => {
    let active = true;
    listRegulationRules()
      .then((rows) => {
        if (!active) return;
        setRules(rows);
        setLoadFailed(false);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function transition(rule: RegulationRuleResponse, status: RegulationRuleStatus) {
    if (status === 'draft') return;
    setTransitionError(false);
    setBusy(true);
    try {
      const reviewedBy = reviewerNames[rule.id]?.trim();
      const { rule: updated } = await transitionRegulationRule(rule.id, {
        status,
        ...(status === 'approved' && reviewedBy ? { reviewedBy } : {}),
      });
      setRules((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    } catch {
      setTransitionError(true);
    } finally {
      setBusy(false);
    }
  }

  const draftIsValid =
    /^[a-z0-9_]{3,80}$/.test(draft.ruleKey) &&
    draft.title.trim().length >= 3 &&
    draft.statement.trim().length >= 10 &&
    draft.sourceCitation.trim().length >= 3;

  async function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftIsValid) return;
    setCreateError(false);
    setBusy(true);
    try {
      const { rule } = await createRegulationRule({
        ruleKey: draft.ruleKey,
        title: draft.title.trim(),
        statement: draft.statement.trim(),
        sourceCitation: draft.sourceCitation.trim(),
        ...(draft.sourceAuthority.trim() ? { sourceAuthority: draft.sourceAuthority.trim() } : {}),
        ...(draft.effectiveFrom ? { effectiveFrom: draft.effectiveFrom } : {}),
      });
      setRules((current) => [rule, ...current]);
      setDraft(EMPTY_DRAFT);
    } catch {
      setCreateError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card readable-form regulation-admin" aria-labelledby="regulation-title">
      <h2 id="regulation-title">{t('regulation.title')}</h2>
      <p>{t('regulation.intro')}</p>
      {/* Reviewed reference content, never legal advice (fail-closed boundary). */}
      <p className="muted">{t('regulation.disclaimer')}</p>
      {loadFailed ? <p role="alert">{t('regulation.loadError')}</p> : null}
      {transitionError ? <p role="alert">{t('regulation.transitionFailed')}</p> : null}
      {!loadFailed && rules.length === 0 ? <p>{t('regulation.empty')}</p> : null}
      <ul className="regulation-rule-list">
        {rules.map((rule) => (
          <li key={rule.id} className="regulation-rule">
            <div className="regulation-rule-header">
              <h3>{rule.title}</h3>
              <StatusBadge
                tone={STATUS_TONES[rule.status]}
                label={t(`regulation.status.${rule.status}`)}
              />
            </div>
            <p>{rule.statement}</p>
            <dl className="regulation-provenance">
              <dt>{t('regulation.source')}</dt>
              <dd>
                {rule.sourceCitation}
                {rule.sourceAuthority ? ` — ${rule.sourceAuthority}` : ''}
              </dd>
              <dt>{t('regulation.version')}</dt>
              <dd>v{rule.version}</dd>
              <dt>{t('regulation.effectiveFrom')}</dt>
              <dd dir="ltr">
                {rule.effectiveFrom ?? '—'}
                {rule.effectiveTo ? ` → ${rule.effectiveTo}` : ''}
              </dd>
              {rule.reviewedBy ? (
                <>
                  <dt>{t('regulation.reviewedBy')}</dt>
                  <dd>{rule.reviewedBy}</dd>
                </>
              ) : null}
            </dl>
            {rule.requiresProfessionalValidation ? (
              <p className="muted">{t('regulation.requiresValidation')}</p>
            ) : null}
            {rule.status === 'in_review' ? (
              <label>
                {t('regulation.reviewerName')}
                <input
                  value={reviewerNames[rule.id] ?? ''}
                  onChange={(event) =>
                    setReviewerNames((current) => ({ ...current, [rule.id]: event.target.value }))
                  }
                />
                <small>{t('regulation.reviewerNameHelp')}</small>
              </label>
            ) : null}
            <div className="button-row">
              {RULE_TRANSITIONS[rule.status].map((next) => (
                <Button
                  key={next}
                  type="button"
                  disabled={
                    busy ||
                    (next === 'approved' && (reviewerNames[rule.id]?.trim().length ?? 0) < 2)
                  }
                  onClick={() => void transition(rule, next)}
                >
                  {t(TRANSITION_LABEL_KEYS[next as Exclude<RegulationRuleStatus, 'draft'>])}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <form className="regulation-create" onSubmit={(event) => void submitDraft(event)}>
        <h3>{t('regulation.createTitle')}</h3>
        <label>
          {t('regulation.ruleKey')}
          <input
            dir="ltr"
            value={draft.ruleKey}
            onChange={(event) => setDraft({ ...draft, ruleKey: event.target.value })}
          />
          <small>{t('regulation.ruleKeyHelp')}</small>
        </label>
        <label>
          {t('regulation.ruleTitle')}
          <input
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>
        <label>
          {t('regulation.statement')}
          <textarea
            value={draft.statement}
            onChange={(event) => setDraft({ ...draft, statement: event.target.value })}
          />
        </label>
        <label>
          {t('regulation.source')}
          <input
            value={draft.sourceCitation}
            onChange={(event) => setDraft({ ...draft, sourceCitation: event.target.value })}
          />
        </label>
        <label>
          {t('regulation.authority')}
          <input
            value={draft.sourceAuthority}
            onChange={(event) => setDraft({ ...draft, sourceAuthority: event.target.value })}
          />
        </label>
        <label>
          {t('regulation.effectiveFrom')}
          <input
            dir="ltr"
            type="date"
            value={draft.effectiveFrom}
            onChange={(event) => setDraft({ ...draft, effectiveFrom: event.target.value })}
          />
        </label>
        {createError ? <p role="alert">{t('regulation.createFailed')}</p> : null}
        <Button type="submit" disabled={busy || !draftIsValid}>
          {t('regulation.createDraft')}
        </Button>
      </form>
    </section>
  );
}

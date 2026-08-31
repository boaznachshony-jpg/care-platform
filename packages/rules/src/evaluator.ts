import {
  compareIsraelDates,
  israelDate,
  toIsraelDate,
  type RuleVersionStatus,
} from '@caredesk/domain';

/**
 * Shell only (Milestone 0) — proves the deterministic-evaluation shape.
 * No legal/payroll condition or action content belongs here until Milestone 2,
 * and even then only behind RuleSource/RuleApproval metadata
 * (database-blueprint.md §4.9, Constitution §20).
 */
export interface RuleFact {
  readonly [key: string]: string | number | boolean | null;
}

export interface RuleEvaluationInput {
  ruleVersionId: string;
  status: RuleVersionStatus;
  facts: RuleFact;
}

export interface RuleEvaluationResult {
  ruleVersionId: string;
  matched: boolean;
  explanation: string;
}

export interface RuleEvaluator {
  evaluate(input: RuleEvaluationInput): RuleEvaluationResult;
}

export const SAFE_RULE_OUTPUTS = [
  'create_attention',
  'create_task',
  'suggest_reminder',
  'timeline_event',
  'wizard_guidance',
  'score_factor',
  'professional_review_required',
] as const;
export type SafeRuleOutputType = (typeof SAFE_RULE_OUTPUTS)[number];
export interface GovernedRule {
  id: string;
  version: string;
  status: RuleVersionStatus;
  effectiveFrom: string;
  effectiveUntil?: string;
  source: {
    title: string;
    authority?: string;
    lastReviewedAt?: string;
    reviewStatus: 'pending' | 'approved' | 'rejected';
  };
  conditions: { fact: string; operator: 'equals' | 'exists'; value?: string | number | boolean }[];
  outputs: { type: SafeRuleOutputType; key: string }[];
}
export interface GovernedRuleResult {
  ruleId: string;
  version: string;
  matched: boolean;
  outputs: GovernedRule['outputs'];
  provenance: GovernedRule['source'];
  explanation: string;
}

/**
 * Which of two eligible versions of the same rule governs the as-of date.
 * Later `effectiveFrom` first; version number only when the two came into
 * force on the very same day.
 */
function isPreferred(candidate: GovernedRule, incumbent: GovernedRule): boolean {
  const byDate = compareIsraelDates(
    israelDate(candidate.effectiveFrom),
    israelDate(incumbent.effectiveFrom),
  );
  if (byDate !== 0) return byDate > 0;
  return incumbent.version.localeCompare(candidate.version, undefined, { numeric: true }) < 0;
}

/** Deterministic, data-only evaluation. It cannot execute code or invent rule content. */
export function evaluateGovernedRules(
  rules: readonly GovernedRule[],
  facts: RuleFact,
  asOf: string,
): GovernedRuleResult[] {
  // DOM-18(b). `asOf` used to be compared as a raw string against date-typed
  // `effectiveFrom` / `effectiveUntil`. The first caller to pass a timestamp
  // ('2026-01-01T10:00:00Z') made `effectiveUntil < asOf` true for a rule
  // whose last valid day was 2026-01-01 — the rule expired on its own final
  // valid day. Normalising to an Asia/Jerusalem calendar day on entry makes
  // the comparison well-typed and settles which day a timestamp belongs to,
  // rather than leaving it to lexicographic accident.
  const asOfDay = toIsraelDate(asOf);
  const selected = new Map<string, GovernedRule>();
  for (const rule of rules) {
    const effectiveFrom = israelDate(rule.effectiveFrom);
    const effectiveUntil = rule.effectiveUntil ? israelDate(rule.effectiveUntil) : undefined;
    if (
      rule.status !== 'active' ||
      rule.source.reviewStatus !== 'approved' ||
      compareIsraelDates(effectiveFrom, asOfDay) > 0 ||
      // `effectiveUntil` is the LAST valid day, so the rule is still in force
      // on it. This is the same boundary decision as DOM-17.
      (effectiveUntil && compareIsraelDates(effectiveUntil, asOfDay) < 0)
    )
      continue;
    const current = selected.get(rule.id);
    // DOM-18(a). The winner used to be the highest version string, with
    // effectiveFrom serving only as an eligibility gate and never as a
    // tie-breaker. That is backwards for machinery whose purpose is correct
    // historical recalculation: if v3 is back-dated, or two versions overlap in
    // effect, the rule actually in force on the as-of date must win regardless
    // of how its version happens to sort. Latest effectiveFrom <= asOf wins;
    // version breaks an exact tie, and only then.
    if (!current || isPreferred(rule, current)) selected.set(rule.id, rule);
  }
  return [...selected.values()].map((rule) => {
    const matched = rule.conditions.every((condition) =>
      condition.operator === 'exists'
        ? facts[condition.fact] !== null && facts[condition.fact] !== undefined
        : facts[condition.fact] === condition.value,
    );
    return {
      ruleId: rule.id,
      version: rule.version,
      matched,
      outputs: matched
        ? [
            ...new Map(
              rule.outputs.map((output) => [`${output.type}:${output.key}`, output]),
            ).values(),
          ]
        : [],
      provenance: rule.source,
      explanation: matched
        ? 'All approved conditions matched.'
        : 'One or more facts were missing or did not match.',
    };
  });
}

/**
 * A rule whose status isn't `active` must never fire — this is the one
 * behavior Milestone 0 can and must prove before any real condition exists.
 */
export class StatusGatedRuleEvaluator implements RuleEvaluator {
  evaluate(input: RuleEvaluationInput): RuleEvaluationResult {
    if (input.status !== 'active') {
      return {
        ruleVersionId: input.ruleVersionId,
        matched: false,
        explanation: `Rule version status is "${input.status}", not "active" — never evaluated.`,
      };
    }
    return {
      ruleVersionId: input.ruleVersionId,
      matched: false,
      explanation: 'No condition implemented yet — this is a Milestone 0 shell.',
    };
  }
}

import type { RuleVersionStatus } from '@caredesk/domain';

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

/** Deterministic, data-only evaluation. It cannot execute code or invent rule content. */
export function evaluateGovernedRules(
  rules: readonly GovernedRule[],
  facts: RuleFact,
  asOf: string,
): GovernedRuleResult[] {
  const selected = new Map<string, GovernedRule>();
  for (const rule of rules) {
    if (
      rule.status !== 'active' ||
      rule.source.reviewStatus !== 'approved' ||
      rule.effectiveFrom > asOf ||
      (rule.effectiveUntil && rule.effectiveUntil < asOf)
    )
      continue;
    const current = selected.get(rule.id);
    if (!current || current.version.localeCompare(rule.version, undefined, { numeric: true }) < 0)
      selected.set(rule.id, rule);
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

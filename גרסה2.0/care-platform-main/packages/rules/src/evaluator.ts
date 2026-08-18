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

import { describe, expect, it } from 'vitest';
import { StatusGatedRuleEvaluator } from './evaluator.js';

describe('StatusGatedRuleEvaluator', () => {
  it('never matches a rule version that is not active', () => {
    const evaluator = new StatusGatedRuleEvaluator();
    for (const status of [
      'draft',
      'under_review',
      'approved',
      'suspended',
      'superseded',
      'retired',
    ] as const) {
      const result = evaluator.evaluate({ ruleVersionId: 'rv-1', status, facts: {} });
      expect(result.matched).toBe(false);
    }
  });
});

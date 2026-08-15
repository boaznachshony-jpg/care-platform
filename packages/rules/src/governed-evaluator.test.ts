import { describe, expect, it } from 'vitest';
import { evaluateGovernedRules, type GovernedRule } from './evaluator.js';
const rule = (overrides: Partial<GovernedRule> = {}): GovernedRule => ({
  id: 'travel-review',
  version: '1',
  status: 'active',
  effectiveFrom: '2026-01-01',
  source: { title: 'Approved internal policy', reviewStatus: 'approved' },
  conditions: [{ fact: 'passportKnown', operator: 'equals', value: false }],
  outputs: [{ type: 'professional_review_required', key: 'verify_travel' }],
  ...overrides,
});
describe('governed rule evaluator', () => {
  it('selects the effective active approved version with provenance', () => {
    const results = evaluateGovernedRules(
      [
        rule(),
        rule({ version: '2', effectiveFrom: '2027-01-01' }),
        rule({ version: '3', status: 'draft' }),
      ],
      { passportKnown: false },
      '2026-12-31',
    );
    expect(results).toEqual([
      {
        ruleId: 'travel-review',
        version: '1',
        matched: true,
        outputs: [{ type: 'professional_review_required', key: 'verify_travel' }],
        provenance: { title: 'Approved internal policy', reviewStatus: 'approved' },
        explanation: 'All approved conditions matched.',
      },
    ]);
  });
  it('ignores boundary-expired and inactive rules and treats unknown facts as non-matches', () => {
    expect(
      evaluateGovernedRules([rule({ effectiveUntil: '2026-01-01' })], {}, '2026-01-02'),
    ).toEqual([]);
    expect(evaluateGovernedRules([rule()], {}, '2026-01-01')[0]?.matched).toBe(false);
  });
  it('deduplicates outputs', () => {
    const output = { type: 'create_task' as const, key: 'follow_up' };
    expect(
      evaluateGovernedRules(
        [rule({ outputs: [output, output] })],
        { passportKnown: false },
        '2026-01-01',
      )[0]?.outputs,
    ).toEqual([output]);
  });
});

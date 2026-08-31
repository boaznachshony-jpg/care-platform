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
  /**
   * DOM-18(a). The winner used to be the highest version string, with
   * effectiveFrom serving only as an eligibility gate. For machinery whose
   * whole purpose is correct historical recalculation that is backwards: the
   * rule actually in force on the as-of date must win regardless of how its
   * version happens to sort.
   */
  it('selects the version in force on the as-of date, not the highest version number', () => {
    const results = evaluateGovernedRules(
      [
        // A back-dated correction filed later with a higher version number.
        rule({ version: '3', effectiveFrom: '2020-01-01' }),
        // The rule actually in force from 2026.
        rule({ version: '2', effectiveFrom: '2026-01-01' }),
      ],
      { passportKnown: false },
      '2026-06-01',
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.version).toBe('2');
  });

  it('breaks an exact effectiveFrom tie by version, and only then', () => {
    const results = evaluateGovernedRules(
      [rule({ version: '2' }), rule({ version: '10' })],
      { passportKnown: false },
      '2026-06-01',
    );
    expect(results[0]?.version).toBe('10');
  });

  /**
   * DOM-18(b). `effectiveUntil < asOf` was a raw string comparison. The first
   * caller to pass a timestamp made a rule expire on its own final valid day.
   */
  it('keeps a rule in force on its final valid day even when asOf carries a time', () => {
    const results = evaluateGovernedRules(
      [rule({ effectiveUntil: '2026-01-01' })],
      { passportKnown: false },
      '2026-01-01T10:00:00Z',
    );
    expect(results).toHaveLength(1);
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

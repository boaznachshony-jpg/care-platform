import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { resolveVerifiedPayrollRules } from './payroll-policy-resolver.js';

const stored = {
  id: '00000000-0000-4000-8000-000000000001',
  code: 'synthetic-day-rule',
  version: 1,
  status: 'active',
  effective_from: '2026-01-01',
  effective_to: null,
  source_reference: 'https://example.invalid/synthetic-test-policy',
  source_verified_at: new Date('2026-01-01T00:00:00Z'),
  reviewed_by: '00000000-0000-4000-8000-000000000002',
  approved_at: new Date('2026-01-02T00:00:00Z'),
  config: {
    kind: 'day',
    purpose: 'holiday_worked',
    treatment: 'addition',
    dailyRate: 440,
    overlap: 'exclusive',
    priority: 1,
  },
};
describe('server-owned verified payroll policy resolver', () => {
  it('only reads active, effective, reviewed server rules within its tenant transaction', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [stored] });
    const rules = await resolveVerifiedPayrollRules({ query } as unknown as PoolClient, '2026-09');
    expect(query.mock.calls[0]?.[1]).toEqual(['2026-09']);
    expect(query.mock.calls[0]?.[0]).toContain("where status='active'");
    expect(query.mock.calls[0]?.[0]).toContain('source_verified_at <= now()');
    expect(query.mock.calls[0]?.[0]).toContain('approved_at <= now()');
    expect(rules[0]).toMatchObject({
      id: stored.id,
      effectiveFrom: '2026-01-01',
      sourceVerifiedAt: '2026-01-01T00:00:00.000Z',
      config: stored.config,
    });
  });
  it('has no invented fallback rate when no reviewed rule exists', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    expect(
      await resolveVerifiedPayrollRules({ query } as unknown as PoolClient, '2026-09'),
    ).toEqual([]);
  });
  it('refuses a malformed stored configuration through a controlled policy error', async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ rows: [{ ...stored, config: { ...stored.config, dailyRate: 0.005 } }] });
    await expect(
      resolveVerifiedPayrollRules({ query } as unknown as PoolClient, '2026-09'),
    ).rejects.toMatchObject({
      name: 'PayrollPolicyError',
      code: 'rule_unavailable',
      field: stored.id,
    });
  });
});

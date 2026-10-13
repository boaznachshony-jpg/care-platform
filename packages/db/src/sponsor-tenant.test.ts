import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { readSponsorInput, refusalFor, sponsorTenant } from './sponsor-tenant.js';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';

const SUBSCRIPTION_ROW = {
  tenant_id: TENANT_ID,
  status: 'payment_method_pending',
  launch_discount_percent: 0,
  price_agorot: 3900,
  charging_starts_at: '2026-09-26',
  next_charge_on: '2026-09-26',
  card_last4: null,
};

// `null`, not `undefined`: a default parameter would swallow `undefined` and
// hand the "row is missing" test a row.
function fakePool(row: Record<string, unknown> | null = SUBSCRIPTION_ROW) {
  const statements: string[] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    statements.push(sql.trim().split('\n')[0]!.trim());
    if (sql.startsWith('select tenant_id, status')) return { rows: row ? [row] : [] };
    if (sql.trim().startsWith('update product_subscription')) {
      const percent = params?.[1] as number;
      return {
        rows: [
          {
            ...SUBSCRIPTION_ROW,
            launch_discount_percent: percent,
            status: percent === 100 ? 'sponsored' : SUBSCRIPTION_ROW.status,
            next_charge_on: percent === 100 ? null : SUBSCRIPTION_ROW.next_charge_on,
          },
        ],
      };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { pool: { connect } as unknown as Pool, query, statements, release };
}

const VALID_ENV = {
  SPONSOR_TENANT_ID: TENANT_ID,
  SPONSOR_DISCOUNT_PERCENT: '100',
  SPONSOR_REASON: 'founding family',
} as NodeJS.ProcessEnv;

describe('readSponsorInput', () => {
  it('requires a tenant or an email', () => {
    expect(() => readSponsorInput({ ...VALID_ENV, SPONSOR_TENANT_ID: undefined })).toThrow(
      /SPONSOR_TENANT_ID or SPONSOR_EMAIL/,
    );
  });

  it('rejects a percent that is not a whole number from 0 to 100', () => {
    for (const value of ['101', '12.5', '-1', 'all', '']) {
      expect(() => readSponsorInput({ ...VALID_ENV, SPONSOR_DISCOUNT_PERCENT: value })).toThrow(
        /0 to 100/,
      );
    }
  });

  it('requires a reason — a discount with no recorded reason reads as a mistake later', () => {
    expect(() => readSponsorInput({ ...VALID_ENV, SPONSOR_REASON: undefined })).toThrow(
      /SPONSOR_REASON is required/,
    );
  });

  it('is a dry run unless SPONSOR_APPLY is exactly true', () => {
    expect(readSponsorInput(VALID_ENV).apply).toBe(false);
    expect(readSponsorInput({ ...VALID_ENV, SPONSOR_APPLY: 'yes' }).apply).toBe(false);
    expect(readSponsorInput({ ...VALID_ENV, SPONSOR_APPLY: 'TRUE' }).apply).toBe(true);
  });
});

describe('refusalFor', () => {
  it('refuses to lower an existing full sponsorship', () => {
    const sponsored = {
      tenantId: TENANT_ID,
      status: 'sponsored',
      launchDiscountPercent: 100,
      priceAgorot: 3900,
      chargingStartsAt: null,
      nextChargeOn: null,
      hasPaymentMethod: false,
    };
    // Undoing a sponsorship decides when somebody starts being charged.
    expect(refusalFor(sponsored, 0)).toMatch(/not done from here/);
    expect(refusalFor(sponsored, 100)).toBeNull();
  });
});

describe('sponsorTenant', () => {
  it('writes nothing on a dry run', async () => {
    const db = fakePool();
    const result = await sponsorTenant(db.pool, {
      tenantId: TENANT_ID,
      discountPercent: 100,
      reason: 'founding family',
      apply: false,
    });

    expect(result.after).toBeNull();
    expect(result.before.launchDiscountPercent).toBe(0);
    expect(db.statements).not.toContainEqual(expect.stringContaining('update'));
    expect(db.statements).toContain('rollback');
    expect(db.statements).not.toContain('commit');
  });

  it('sponsors the account, clears the next charge, and records why', async () => {
    const db = fakePool();
    const result = await sponsorTenant(db.pool, {
      tenantId: TENANT_ID,
      discountPercent: 100,
      reason: 'founding family',
      apply: true,
    });

    expect(result.after?.launchDiscountPercent).toBe(100);
    expect(result.after?.status).toBe('sponsored');
    // Nothing is collected from a sponsored account, so no date may be left
    // behind pointing at a charge.
    expect(result.after?.nextChargeOn).toBeNull();

    const audit = db.query.mock.calls.find(([sql]) => sql.includes('insert into audit_event'));
    expect(audit).toBeDefined();
    expect(audit?.[1]).toContain('founding family');
    expect(db.statements).toContain('commit');
  });

  it('rolls back and never commits when the subscription row does not exist yet', async () => {
    const db = fakePool(null);
    await expect(
      sponsorTenant(db.pool, {
        tenantId: TENANT_ID,
        discountPercent: 100,
        reason: 'founding family',
        apply: true,
      }),
    ).rejects.toThrow(/no product_subscription row/);

    expect(db.statements).toContain('rollback');
    expect(db.statements).not.toContain('commit');
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  activateProductSubscription,
  BILLING_ACTIVATION_ACKNOWLEDGEMENT,
} from './activate-product-subscription.js';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';

function fakePool(row?: { tenant_id: string; charging_starts_at: string }) {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('update product_subscription')) return { rows: row ? [row] : [] };
    return { rows: [] };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { pool: { connect } as unknown as Pool, query, release, connect };
}

describe('activateProductSubscription', () => {
  it('requires the exact customer-notice acknowledgement before touching the database', async () => {
    const db = fakePool();
    await expect(
      activateProductSubscription(db.pool, {
        tenantId: TENANT_ID,
        chargingStartsAt: '2026-09-01',
        confirmation: 'yes',
      }),
    ).rejects.toThrow('I_HAVE_NOTIFIED_THE_CUSTOMER');
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('rejects impossible dates before touching the database', async () => {
    const db = fakePool();
    await expect(
      activateProductSubscription(db.pool, {
        tenantId: TENANT_ID,
        chargingStartsAt: '2026-02-31',
        confirmation: BILLING_ACTIVATION_ACKNOWLEDGEMENT,
      }),
    ).rejects.toThrow('real YYYY-MM-DD');
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('activates only a subscription with accepted terms and a saved token', async () => {
    const db = fakePool({ tenant_id: TENANT_ID, charging_starts_at: '2026-09-01' });
    await expect(
      activateProductSubscription(db.pool, {
        tenantId: TENANT_ID,
        chargingStartsAt: '2026-09-01',
        confirmation: BILLING_ACTIVATION_ACKNOWLEDGEMENT,
      }),
    ).resolves.toEqual({ tenantId: TENANT_ID, chargingStartsAt: '2026-09-01' });
    expect(db.query.mock.calls[1]?.[0]).toContain('launch_discount_percent = 0');
    expect(db.query.mock.calls[1]?.[0]).toContain('sealed_payment_token is not null');
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('commit');
    expect(db.release).toHaveBeenCalledOnce();
  });

  it('rolls back when the tenant is not ready for paid billing', async () => {
    const db = fakePool();
    await expect(
      activateProductSubscription(db.pool, {
        tenantId: TENANT_ID,
        chargingStartsAt: '2026-09-01',
        confirmation: BILLING_ACTIVATION_ACKNOWLEDGEMENT,
      }),
    ).rejects.toThrow('Subscription was not activated');
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('rollback');
    expect(db.release).toHaveBeenCalledOnce();
  });
});

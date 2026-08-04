import { pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import { createPool } from './pool.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const BILLING_ACTIVATION_ACKNOWLEDGEMENT =
  'I_HAVE_NOTIFIED_THE_CUSTOMER_AND_APPROVE_MONTHLY_CHARGING';

export interface ActivateProductSubscriptionInput {
  tenantId: string;
  chargingStartsAt: string;
  confirmation: string;
}

function isValidCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
  );
}

export async function activateProductSubscription(
  pool: Pool,
  input: ActivateProductSubscriptionInput,
): Promise<{ tenantId: string; chargingStartsAt: string }> {
  if (!UUID_PATTERN.test(input.tenantId)) {
    throw new Error('BILLING_ACTIVATION_TENANT_ID must be a valid tenant UUID.');
  }
  if (!isValidCalendarDate(input.chargingStartsAt)) {
    throw new Error('BILLING_ACTIVATION_START_DATE must be a real YYYY-MM-DD date.');
  }
  if (input.confirmation !== BILLING_ACTIVATION_ACKNOWLEDGEMENT) {
    throw new Error(
      `BILLING_ACTIVATION_CONFIRMATION must equal ${BILLING_ACTIVATION_ACKNOWLEDGEMENT}.`,
    );
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query<{ tenant_id: string; charging_starts_at: string }>(
      `update product_subscription
          set status = 'payment_method_ready',
              launch_discount_percent = 0,
              charging_starts_at = $2::date,
              next_charge_on = $2::date,
              updated_at = now()
        where tenant_id = $1
          and status in ('sponsored', 'payment_method_ready')
          and sealed_payment_token is not null
          and terms_accepted_at is not null
          and billing_name is not null
          and billing_email is not null
        returning tenant_id, charging_starts_at`,
      [input.tenantId, input.chargingStartsAt],
    );
    const activated = result.rows[0];
    if (!activated) {
      throw new Error(
        'Subscription was not activated. Verify the tenant, accepted terms, and saved payment method.',
      );
    }
    await client.query('commit');
    return { tenantId: activated.tenant_id, chargingStartsAt: activated.charging_starts_at };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) throw new Error('DATABASE_ADMIN_URL is required in .env.local.');
  const input: ActivateProductSubscriptionInput = {
    tenantId: process.env.BILLING_ACTIVATION_TENANT_ID?.trim() ?? '',
    chargingStartsAt: process.env.BILLING_ACTIVATION_START_DATE?.trim() ?? '',
    confirmation: process.env.BILLING_ACTIVATION_CONFIRMATION?.trim() ?? '',
  };
  const pool = createPool(connectionString);
  try {
    const result = await activateProductSubscription(pool, input);
    console.log('Paid monthly billing activated after explicit operator acknowledgement.');
    console.log(`Tenant: ${result.tenantId}`);
    console.log(`First charge date: ${result.chargingStartsAt}`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

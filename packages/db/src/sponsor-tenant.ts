import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { Pool, PoolClient } from 'pg';
import { createPool } from './pool.js';

/**
 * Set one tenant's subscription discount, deliberately and by hand.
 *
 * WHY A SCRIPT AND NOT A SCREEN
 * -----------------------------
 * `BILLING_LAUNCH_DISCOUNT_PERCENT` is a deployment-wide default applied to
 * every subscription created after it is set; there was no way to sponsor one
 * account. The obvious alternative — an admin screen — is a permanent new
 * authenticated surface that can change what a customer is charged, and it
 * would have to be designed, authorized, rate-limited and audited before it
 * could be trusted anywhere near a live account. This is a command an operator
 * runs on purpose, from a machine that already holds the owner credential. It
 * adds no route, no permission and no UI, and nothing can invoke it on its own.
 *
 * A 100% discount is a sponsored account: `deriveBillingAccessState` returns
 * `active` for one unconditionally, so a sponsored tenant is never frozen and
 * is never charged (`billing-schedule.ts`: "there is nothing to collect").
 *
 * DRY RUN BY DEFAULT
 * ------------------
 * Without `SPONSOR_APPLY=true` this reads the row, prints what it would change
 * and exits without writing. Against a live database a command that acts on its
 * first invocation is a command that acts on a typo.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * It refuses to lower the discount of an already-sponsored account. Undoing a
 * sponsorship correctly depends on whether a payment method exists and when the
 * next charge should fall, and guessing wrong starts charging somebody who was
 * not expecting it. That path belongs in the billing flow, not here.
 *
 * It never deletes a row and never touches another tenant: every statement is
 * keyed by the one tenant id, inside one transaction, with an audit_event
 * recorded alongside the change.
 *
 * USAGE
 * -----
 *   SPONSOR_TENANT_ID=<uuid>            (or SPONSOR_EMAIL=<owner's email>)
 *   SPONSOR_DISCOUNT_PERCENT=100
 *   SPONSOR_REASON="founding family, free for now"
 *   SPONSOR_OPERATOR_USER_ID=<uuid>     (optional; recorded as the actor)
 *   SPONSOR_APPLY=true                  (omit for a dry run)
 *   pnpm db:sponsor
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SponsorInput {
  tenantId?: string;
  email?: string;
  discountPercent: number;
  reason: string;
  operatorUserId?: string;
  apply: boolean;
}

export interface SubscriptionSnapshot {
  tenantId: string;
  status: string;
  launchDiscountPercent: number;
  priceAgorot: number;
  chargingStartsAt: string | null;
  nextChargeOn: string | null;
  hasPaymentMethod: boolean;
}

interface SubscriptionRow {
  tenant_id: string;
  status: string;
  launch_discount_percent: number;
  price_agorot: number;
  charging_starts_at: string | null;
  next_charge_on: string | null;
  card_last4: string | null;
}

const toSnapshot = (row: SubscriptionRow): SubscriptionSnapshot => ({
  tenantId: row.tenant_id,
  status: row.status,
  launchDiscountPercent: row.launch_discount_percent,
  priceAgorot: row.price_agorot,
  chargingStartsAt: row.charging_starts_at,
  nextChargeOn: row.next_charge_on,
  hasPaymentMethod: row.card_last4 !== null,
});

export function readSponsorInput(env: NodeJS.ProcessEnv): SponsorInput {
  const tenantId = env.SPONSOR_TENANT_ID?.trim() || undefined;
  const email = env.SPONSOR_EMAIL?.trim().toLowerCase() || undefined;
  if (!tenantId && !email) {
    throw new Error('Supply SPONSOR_TENANT_ID or SPONSOR_EMAIL.');
  }
  if (tenantId && !UUID_PATTERN.test(tenantId)) {
    throw new Error('SPONSOR_TENANT_ID must be a UUID.');
  }

  const raw = env.SPONSOR_DISCOUNT_PERCENT?.trim() ?? '';
  if (!/^\d{1,3}$/.test(raw)) {
    throw new Error('SPONSOR_DISCOUNT_PERCENT must be a whole number from 0 to 100.');
  }
  const discountPercent = Number(raw);
  if (discountPercent > 100) {
    throw new Error('SPONSOR_DISCOUNT_PERCENT must be a whole number from 0 to 100.');
  }

  // Required, because a discount with no recorded reason is indistinguishable
  // from a mistake six months later.
  const reason = env.SPONSOR_REASON?.trim() ?? '';
  if (reason.length < 3 || reason.length > 200) {
    throw new Error('SPONSOR_REASON is required (3-200 characters).');
  }

  const operatorUserId = env.SPONSOR_OPERATOR_USER_ID?.trim() || undefined;
  if (operatorUserId && !UUID_PATTERN.test(operatorUserId)) {
    throw new Error('SPONSOR_OPERATOR_USER_ID must be a UUID when supplied.');
  }

  return {
    tenantId,
    email,
    discountPercent,
    reason,
    operatorUserId,
    apply: (env.SPONSOR_APPLY ?? '').trim().toLowerCase() === 'true',
  };
}

async function resolveTenantId(client: PoolClient, input: SponsorInput): Promise<string> {
  if (input.tenantId) return input.tenantId;
  const result = await client.query<{ tenant_id: string }>(
    `select m.tenant_id
       from app_user u
       join tenant_membership m on m.user_id = u.id
      where lower(u.email) = $1
        and m.status = 'active'
        and m.valid_from <= now()
        and (m.valid_to is null or m.valid_to > now())
      limit 2`,
    [input.email],
  );
  if (result.rows.length === 0) throw new Error('No active membership found for SPONSOR_EMAIL.');
  if (result.rows.length > 1) {
    throw new Error('SPONSOR_EMAIL belongs to more than one tenant; pass SPONSOR_TENANT_ID.');
  }
  return result.rows[0]!.tenant_id;
}

async function readSubscription(
  client: PoolClient,
  tenantId: string,
): Promise<SubscriptionSnapshot> {
  const result = await client.query<SubscriptionRow>(
    `select tenant_id, status, launch_discount_percent, price_agorot,
            charging_starts_at::text, next_charge_on::text, card_last4
       from product_subscription
      where tenant_id = $1`,
    [tenantId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(
      'This tenant has no product_subscription row yet. It is created the first time the ' +
        'account opens the billing screen; sponsor it after that.',
    );
  }
  return toSnapshot(row);
}

/**
 * The guard described in the file comment: lowering a sponsorship is a billing
 * decision with a charge attached, and this command does not make those.
 */
export function refusalFor(before: SubscriptionSnapshot, discountPercent: number): string | null {
  if (before.launchDiscountPercent === 100 && discountPercent < 100) {
    return (
      'This account is currently fully sponsored. Lowering the discount decides when it starts ' +
      'being charged and whether a card is on file to charge, so it is not done from here.'
    );
  }
  return null;
}

export async function sponsorTenant(
  pool: Pool,
  input: SponsorInput,
): Promise<{ before: SubscriptionSnapshot; after: SubscriptionSnapshot | null }> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const tenantId = await resolveTenantId(client, input);
    const before = await readSubscription(client, tenantId);

    const refusal = refusalFor(before, input.discountPercent);
    if (refusal) throw new Error(refusal);

    if (!input.apply) {
      await client.query('rollback');
      return { before, after: null };
    }

    // A full sponsorship is also a status and a schedule: nothing is collected,
    // so there is no next charge to leave behind pointing at a date.
    const sponsored = input.discountPercent === 100;
    const updated = await client.query<SubscriptionRow>(
      `update product_subscription
          set launch_discount_percent = $2,
              status = case when $3 then 'sponsored' else status end,
              next_charge_on = case when $3 then null else next_charge_on end,
              updated_at = now()
        where tenant_id = $1
        returning tenant_id, status, launch_discount_percent, price_agorot,
                  charging_starts_at::text, next_charge_on::text, card_last4`,
      [tenantId, input.discountPercent, sponsored],
    );
    const after = toSnapshot(updated.rows[0]!);

    await client.query(
      `insert into audit_event
         (tenant_id, actor_id, action, resource_type, resource_id, occurred_at,
          correlation_id, source_channel, purpose, change_summary, sensitivity, reason)
       values ($1, $2, 'product_subscription.discount_set', 'product_subscription', $1, now(),
               $3, 'system', 'billing_administration', $4, 'financial_sensitive', $5)`,
      [
        tenantId,
        input.operatorUserId ?? null,
        randomUUID(),
        `Subscription discount set from ${before.launchDiscountPercent}% to ${after.launchDiscountPercent}%.`,
        input.reason,
      ],
    );

    await client.query('commit');
    return { before, after };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function describe(label: string, snapshot: SubscriptionSnapshot): void {
  console.log(`  ${label}`);
  console.log(`    status                 ${snapshot.status}`);
  console.log(`    discount               ${snapshot.launchDiscountPercent}%`);
  console.log(`    price                  ${(snapshot.priceAgorot / 100).toFixed(2)} ILS`);
  console.log(`    charging starts        ${snapshot.chargingStartsAt ?? '-'}`);
  console.log(`    next charge            ${snapshot.nextChargeOn ?? '-'}`);
  console.log(`    payment method on file ${snapshot.hasPaymentMethod ? 'yes' : 'no'}`);
}

async function main(): Promise<void> {
  const input = readSponsorInput(process.env);
  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) {
    throw new Error('DATABASE_ADMIN_URL is required (this changes a tenant-owned row).');
  }

  const pool = createPool(connectionString);
  try {
    const { before, after } = await sponsorTenant(pool, input);
    console.log(`Tenant ${before.tenantId}`);
    describe('before', before);
    if (!after) {
      console.log(`  would set the discount to ${input.discountPercent}%`);
      console.log('\nDRY RUN - nothing was written. Re-run with SPONSOR_APPLY=true to apply.');
      return;
    }
    describe('after', after);
    console.log(`\nApplied. Reason recorded: ${input.reason}`);
    if (after.launchDiscountPercent === 100) {
      console.log('This account is now fully sponsored: never charged, and never frozen.');
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

import type {
  BillingDefaults,
  BillingRepository,
  BillingSetupIntentRecord,
  DueBillingCharge,
  ProductSubscriptionRecord,
  StoredPaymentMethod,
} from '@caredesk/application';
import type { ProductSubscriptionStatus } from '@caredesk/domain';
import type { Pool } from 'pg';
import { withTenant } from './pool.js';

interface SubscriptionRow {
  tenant_id: string;
  status: ProductSubscriptionStatus;
  price_agorot: number;
  vat_rate_bps: number;
  launch_discount_percent: number;
  charging_starts_at: string | null;
  next_charge_on: string | null;
  billing_name: string | null;
  billing_email: string | null;
  terms_version: string | null;
  terms_accepted_at: Date | null;
  provider_setup_id: string | null;
  sealed_payment_token: string | null;
  card_expiry_month: number | null;
  card_expiry_year: number | null;
  card_last4: string | null;
}

interface IntentRow {
  id: string;
  tenant_id: string;
  created_by: string;
  billing_name: string;
  billing_email: string;
  terms_version: string;
  terms_accepted_at: Date;
  provider_setup_id: string | null;
  status: BillingSetupIntentRecord['status'];
}

function toSubscription(row: SubscriptionRow): ProductSubscriptionRecord {
  const hasPaymentMethod =
    row.provider_setup_id &&
    row.sealed_payment_token &&
    row.card_expiry_month &&
    row.card_expiry_year &&
    row.card_last4;
  return {
    tenantId: row.tenant_id,
    status: row.status,
    priceAgorot: row.price_agorot,
    vatRateBps: row.vat_rate_bps,
    launchDiscountPercent: row.launch_discount_percent,
    chargingStartsAt: row.charging_starts_at,
    nextChargeOn: row.next_charge_on,
    billingName: row.billing_name,
    billingEmail: row.billing_email,
    termsVersion: row.terms_version,
    termsAcceptedAt: row.terms_accepted_at?.toISOString() ?? null,
    paymentMethod: hasPaymentMethod
      ? {
          providerSetupId: row.provider_setup_id!,
          sealedToken: row.sealed_payment_token!,
          expiryMonth: row.card_expiry_month!,
          expiryYear: row.card_expiry_year!,
          last4: row.card_last4!,
        }
      : null,
  };
}

function toIntent(row: IntentRow): BillingSetupIntentRecord {
  return {
    intentId: row.id,
    tenantId: row.tenant_id,
    createdBy: row.created_by,
    billingName: row.billing_name,
    billingEmail: row.billing_email,
    termsVersion: row.terms_version,
    termsAcceptedAt: row.terms_accepted_at.toISOString(),
    providerSetupId: row.provider_setup_id,
    status: row.status,
  };
}

const SUBSCRIPTION_COLUMNS = `tenant_id, status, price_agorot, vat_rate_bps,
  launch_discount_percent, charging_starts_at, next_charge_on, billing_name,
  billing_email, terms_version, terms_accepted_at, provider_setup_id,
  sealed_payment_token, card_expiry_month, card_expiry_year, card_last4`;

export class PgBillingRepository implements BillingRepository {
  constructor(private readonly pool: Pool) {}

  async getOrCreate(
    tenantId: string,
    defaults: BillingDefaults,
  ): Promise<ProductSubscriptionRecord> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<SubscriptionRow>(
        `insert into product_subscription
           (tenant_id, status, price_agorot, vat_rate_bps, launch_discount_percent,
            charging_starts_at, next_charge_on)
         values ($1, 'sponsored', $2, $3, $4, $5::date, $5::date)
         on conflict (tenant_id) do nothing
         returning ${SUBSCRIPTION_COLUMNS}`,
        [
          tenantId,
          defaults.priceAgorot,
          defaults.vatRateBps,
          defaults.launchDiscountPercent,
          defaults.chargingStartsAt,
        ],
      );
      const inserted = result.rows[0];
      if (inserted) return toSubscription(inserted);
      const existing = await client.query<SubscriptionRow>(
        `select ${SUBSCRIPTION_COLUMNS} from product_subscription where tenant_id = $1`,
        [tenantId],
      );
      if (!existing.rows[0]) throw new Error('Product subscription was not found.');
      return toSubscription(existing.rows[0]);
    });
  }

  async createSetupIntent(intent: BillingSetupIntentRecord): Promise<void> {
    await withTenant(this.pool, intent.tenantId, async (client) => {
      await client.query(
        `insert into billing_setup_intent
           (id, tenant_id, created_by, billing_name, billing_email,
            terms_version, terms_accepted_at, provider_setup_id, status)
         values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9)`,
        [
          intent.intentId,
          intent.tenantId,
          intent.createdBy,
          intent.billingName,
          intent.billingEmail,
          intent.termsVersion,
          intent.termsAcceptedAt,
          intent.providerSetupId,
          intent.status,
        ],
      );
    });
  }

  async attachProviderSetup(
    tenantId: string,
    intentId: string,
    providerSetupId: string,
  ): Promise<void> {
    await withTenant(this.pool, tenantId, async (client) => {
      await client.query(
        `update billing_setup_intent
            set provider_setup_id = $2, status = 'pending', updated_at = now()
          where id = $1 and status = 'created'`,
        [intentId, providerSetupId],
      );
      await client.query(
        `update product_subscription
            set status = 'payment_method_pending', updated_at = now()
          where tenant_id = $1`,
        [tenantId],
      );
    });
  }

  async findSetupIntentByProviderId(
    providerSetupId: string,
  ): Promise<BillingSetupIntentRecord | null> {
    // Only a server-to-server verified Cardcom webhook calls this global lookup.
    const result = await this.pool.query<IntentRow>(
      'select * from find_caredesk_billing_setup_intent($1)',
      [providerSetupId],
    );
    return result.rows[0] ? toIntent(result.rows[0]) : null;
  }

  async completePaymentMethodSetup(
    tenantId: string,
    intentId: string,
    paymentMethod: StoredPaymentMethod,
  ): Promise<ProductSubscriptionRecord> {
    return withTenant(this.pool, tenantId, async (client) => {
      const intent = await client.query<IntentRow>(
        `update billing_setup_intent set status = 'completed', updated_at = now()
          where id = $1 and status in ('pending', 'completed')
          returning id, tenant_id, created_by, billing_name, billing_email,
                    terms_version, terms_accepted_at, provider_setup_id, status`,
        [intentId],
      );
      const row = intent.rows[0];
      if (!row) throw new Error('Billing setup intent is not pending.');
      const result = await client.query<SubscriptionRow>(
        `update product_subscription
            set status = case when charging_starts_at is null then 'sponsored'
                              else 'payment_method_ready' end,
                billing_name = $2, billing_email = $3, terms_version = $4,
                terms_accepted_at = $5, provider_setup_id = $6,
                sealed_payment_token = $7, card_expiry_month = $8,
                card_expiry_year = $9, card_last4 = $10, updated_at = now()
          where tenant_id = $1
          returning ${SUBSCRIPTION_COLUMNS}`,
        [
          tenantId,
          row.billing_name,
          row.billing_email,
          row.terms_version,
          row.terms_accepted_at,
          paymentMethod.providerSetupId,
          paymentMethod.sealedToken,
          paymentMethod.expiryMonth,
          paymentMethod.expiryYear,
          paymentMethod.last4,
        ],
      );
      if (!result.rows[0]) throw new Error('Product subscription not found.');
      return toSubscription(result.rows[0]);
    });
  }

  async failPaymentMethodSetup(tenantId: string, intentId: string): Promise<void> {
    await withTenant(this.pool, tenantId, async (client) => {
      await client.query(
        `update billing_setup_intent set status = 'failed', updated_at = now()
          where id = $1 and status <> 'completed'`,
        [intentId],
      );
    });
  }

  async cancel(tenantId: string, cancelledAt: string): Promise<void> {
    await withTenant(this.pool, tenantId, async (client) => {
      await client.query(
        `update product_subscription
            set status = 'cancelled', next_charge_on = null,
                provider_setup_id = null, sealed_payment_token = null,
                card_expiry_month = null, card_expiry_year = null, card_last4 = null,
                updated_at = $2::timestamptz
          where tenant_id = $1`,
        [tenantId, cancelledAt],
      );
    });
  }

  async claimDueCharges(now: string, limit: number): Promise<DueBillingCharge[]> {
    const result = await this.pool.query<{
      charge_id: string;
      tenant_id: string;
      billing_period: string;
      external_uniq_id: string;
      amount_agorot: number;
      billing_name: string;
      billing_email: string;
      provider_setup_id: string;
      sealed_payment_token: string;
      card_expiry_month: number;
      card_expiry_year: number;
      card_last4: string;
    }>('select * from claim_caredesk_product_billing_charges($1::timestamptz, $2)', [now, limit]);
    return result.rows.map((row) => ({
      chargeId: row.charge_id,
      tenantId: row.tenant_id,
      billingPeriod: row.billing_period,
      externalUniqId: row.external_uniq_id,
      amountAgorot: row.amount_agorot,
      billingName: row.billing_name,
      billingEmail: row.billing_email,
      paymentMethod: {
        providerSetupId: row.provider_setup_id,
        sealedToken: row.sealed_payment_token,
        expiryMonth: row.card_expiry_month,
        expiryYear: row.card_expiry_year,
        last4: row.card_last4,
      },
    }));
  }

  async markChargeSucceeded(chargeId: string, providerTransactionId: string): Promise<void> {
    await this.pool.query('select complete_caredesk_product_billing_charge($1, $2, now())', [
      chargeId,
      providerTransactionId,
    ]);
  }

  async markChargeFailed(chargeId: string, failureCode: string): Promise<void> {
    await this.pool.query('select fail_caredesk_product_billing_charge($1, $2, now())', [
      chargeId,
      failureCode,
    ]);
  }
}

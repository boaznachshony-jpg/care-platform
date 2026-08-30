-- Billing lifecycle recovery — three ways the system could leave a paying
-- customer in a wrong state and never tell them.
--
-- G-1 (abandoned checkout): starting a hosted card setup overwrote the whole
--     subscription status with 'payment_method_pending', a state the daily
--     claim query excludes. A customer who opened "update card" and closed the
--     tab silently stopped being billed forever while the UI still said
--     "subscription active". The pending setup now has its own columns, so the
--     billing state no longer has to be sacrificed to record it.
--
-- G-3 (cancel is an instant lockout): the grace window is anchored on
--     charging_starts_at, a date months in the past, so cancelling froze the
--     account on the very next render. access_grace_starts_at gives the
--     derivation a second, later anchor that cancellation sets to "today".
--
-- G-5 (three failed attempts is a dead end): the claim function refuses a
--     charge row once attempts reaches 3, so a customer whose card failed three
--     times could never be charged again — not even after fixing the card.
--     Attempts are now scoped to a cycle, and connecting a *newer* payment
--     method opens exactly one fresh cycle. Nothing resets on its own: the
--     customer has to act, which is what makes this an exit and not a loop.
--
-- This migration is strictly additive. No column is dropped, no row is
-- deleted, and no existing value is rewritten. Every new column is nullable or
-- carries a default that matches how existing rows already behave:
-- attempt_cycle defaults to 1, which is the cycle every current row is in.

alter table product_subscription
  add column if not exists pending_setup_intent_id uuid,
  add column if not exists pending_setup_started_at timestamptz,
  add column if not exists access_grace_starts_at date,
  add column if not exists payment_method_updated_at timestamptz;

comment on column product_subscription.pending_setup_intent_id is
  'Hosted card setup currently in flight. Recorded separately from status so an abandoned checkout cannot suspend billing for a customer who already has a working card (G-1).';
comment on column product_subscription.access_grace_starts_at is
  'Later of the two grace anchors. Set on cancellation so the grace window starts then, not at charging_starts_at months earlier (G-3).';
comment on column product_subscription.payment_method_updated_at is
  'When a verified payment method was last stored. A value newer than a failed charge row grants that charge one more attempt cycle (G-5).';

-- Subscriptions that predate this migration keep payment_method_updated_at
-- NULL on purpose: no backfill runs, so no existing value is touched. The
-- claim guard below treats "was NULL, now has a timestamp" as a newer payment
-- method, which is exactly what happens the first time such a customer
-- reconnects a card.

alter table product_billing_charge
  add column if not exists attempt_cycle integer not null default 1,
  add column if not exists payment_method_refreshed_at timestamptz;

alter table product_billing_charge
  add constraint product_billing_charge_attempt_cycle_positive
  check (attempt_cycle between 1 and 10);

comment on column product_billing_charge.attempt_cycle is
  'Which run of up to three attempts this row is on. Incremented only when the customer stores a newer payment method (G-5); capped so a pathological loop cannot bill forever.';
comment on column product_billing_charge.payment_method_refreshed_at is
  'Snapshot of product_subscription.payment_method_updated_at at claim time — i.e. which stored card the current attempt cycle has been trying.';

-- Rebuilt claim function. Signature and result columns are unchanged, so the
-- application-side query and the deployed API keep working across the rollout.
--
-- The only behavioural change is the conflict guard: a charge row that has
-- exhausted its three attempts becomes claimable again when the subscription
-- carries a payment method stored *after* the last attempt. Attempts reset to
-- 1 and the cycle counter advances, which keeps the attempts column inside its
-- original `between 1 and 3` constraint.
create or replace function claim_caredesk_product_billing_charges(
  p_now timestamptz,
  p_limit integer
)
returns table (
  charge_id uuid,
  tenant_id uuid,
  billing_period date,
  external_uniq_id text,
  amount_agorot integer,
  billing_name text,
  billing_email text,
  provider_setup_id uuid,
  sealed_payment_token text,
  card_expiry_month smallint,
  card_expiry_year smallint,
  card_last4 text
)
language sql
volatile
security definer
set search_path = pg_catalog, public
as $$
  with due as materialized (
    select s.*
      from public.product_subscription s
     where s.status in ('payment_method_ready', 'active', 'past_due')
       and s.launch_discount_percent = 0
       and s.charging_starts_at is not null
       and s.charging_starts_at <= p_now::date
       and s.next_charge_on is not null
       and s.next_charge_on <= p_now::date
       and s.sealed_payment_token is not null
       and s.billing_name is not null
       and s.billing_email is not null
     order by s.next_charge_on, s.tenant_id
     limit greatest(1, least(p_limit, 100))
     for update skip locked
  ), claimed as (
    insert into public.product_billing_charge
      (tenant_id, billing_period, external_uniq_id, amount_agorot, status,
       payment_method_refreshed_at)
    select d.tenant_id, d.next_charge_on,
           'caredesk-' || d.tenant_id::text || '-' || d.next_charge_on::text,
           d.price_agorot, 'processing', d.payment_method_updated_at
      from due d
    on conflict (tenant_id, billing_period) do update
      set status = 'processing',
          attempts = case
            when product_billing_charge.attempts < 3
              then product_billing_charge.attempts + 1
            else 1
          end,
          attempt_cycle = case
            when product_billing_charge.attempts < 3
              then product_billing_charge.attempt_cycle
            else product_billing_charge.attempt_cycle + 1
          end,
          payment_method_refreshed_at = excluded.payment_method_refreshed_at,
          failure_code = null,
          updated_at = p_now
      where (
          product_billing_charge.status = 'failed'
          or (
            product_billing_charge.status = 'processing'
            and product_billing_charge.updated_at < p_now - interval '30 minutes'
          )
        )
        and (
          product_billing_charge.attempts < 3
          or (
            -- The exit from a dead-ended period: a payment method stored after
            -- the cycle that failed. Requires a deliberate customer action.
            excluded.payment_method_refreshed_at is not null
            and (
              product_billing_charge.payment_method_refreshed_at is null
              or excluded.payment_method_refreshed_at
                 > product_billing_charge.payment_method_refreshed_at
            )
            and product_billing_charge.attempt_cycle < 10
          )
        )
    returning *
  )
  select c.id, c.tenant_id, c.billing_period, c.external_uniq_id,
         c.amount_agorot, d.billing_name, d.billing_email,
         d.provider_setup_id, d.sealed_payment_token, d.card_expiry_month,
         d.card_expiry_year, d.card_last4
    from claimed c
    join due d on d.tenant_id = c.tenant_id
$$;

revoke all on function claim_caredesk_product_billing_charges(timestamptz, integer) from public;
grant execute on function claim_caredesk_product_billing_charges(timestamptz, integer) to caredesk_app;

insert into schema_migrations (version) values ('0036_billing_lifecycle_recovery');

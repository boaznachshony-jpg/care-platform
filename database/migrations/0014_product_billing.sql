-- CareDesk product subscription billing. This is deliberately separate from
-- caregiver payroll/payment records. Card details never enter this schema;
-- the provider token is encrypted by the API before persistence.

create table product_subscription (
  tenant_id uuid primary key references tenant (id),
  status text not null check (status in (
    'sponsored', 'payment_method_pending', 'payment_method_ready',
    'active', 'past_due', 'cancelled'
  )),
  price_agorot integer not null check (price_agorot > 0),
  vat_rate_bps integer not null check (vat_rate_bps between 0 and 10000),
  launch_discount_percent integer not null check (launch_discount_percent between 0 and 100),
  charging_starts_at date,
  next_charge_on date,
  billing_name text,
  billing_email text,
  terms_version text,
  terms_accepted_at timestamptz,
  provider_setup_id uuid,
  sealed_payment_token text,
  card_expiry_month smallint check (card_expiry_month between 1 and 12),
  card_expiry_year smallint check (card_expiry_year between 2020 and 2200),
  card_last4 text check (card_last4 ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (sealed_payment_token is null and provider_setup_id is null and card_last4 is null)
    or
    (sealed_payment_token is not null and provider_setup_id is not null and card_last4 is not null)
  )
);

create table billing_setup_intent (
  id uuid primary key,
  tenant_id uuid not null references tenant (id),
  created_by uuid not null references app_user (id),
  billing_name text not null,
  billing_email text not null,
  terms_version text not null,
  terms_accepted_at timestamptz not null,
  provider_setup_id uuid unique,
  status text not null check (status in ('created', 'pending', 'completed', 'failed')),
  expires_at timestamptz not null default (now() + interval '2 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table product_billing_charge (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  billing_period date not null,
  external_uniq_id text not null unique,
  amount_agorot integer not null check (amount_agorot > 0),
  status text not null check (status in ('processing', 'succeeded', 'failed')),
  attempts integer not null default 1 check (attempts between 1 and 3),
  provider_transaction_id text,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, billing_period)
);

alter table product_subscription enable row level security;
alter table product_subscription force row level security;
alter table billing_setup_intent enable row level security;
alter table billing_setup_intent force row level security;
alter table product_billing_charge enable row level security;
alter table product_billing_charge force row level security;

create policy product_subscription_isolation on product_subscription
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy billing_setup_intent_isolation on billing_setup_intent
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy product_billing_charge_isolation on product_billing_charge
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

grant select, insert, update on product_subscription to caredesk_app;
grant select, insert, update on billing_setup_intent to caredesk_app;
grant select on product_billing_charge to caredesk_app;

-- Cardcom webhooks carry only an opaque provider setup UUID. The API first
-- verifies it directly with Cardcom and then uses this narrow lookup; it does
-- not receive generic cross-tenant table access.
create or replace function find_caredesk_billing_setup_intent(p_provider_setup_id uuid)
returns table (
  id uuid,
  tenant_id uuid,
  created_by uuid,
  billing_name text,
  billing_email text,
  terms_version text,
  terms_accepted_at timestamptz,
  provider_setup_id uuid,
  status text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select i.id, i.tenant_id, i.created_by, i.billing_name, i.billing_email,
         i.terms_version, i.terms_accepted_at, i.provider_setup_id, i.status
    from public.billing_setup_intent i
   where i.provider_setup_id = p_provider_setup_id
     and (
       i.status = 'completed'
       or (i.status = 'pending' and i.expires_at > now())
     )
$$;

-- The daily worker needs a bounded, idempotent cross-tenant claim. Exposing a
-- narrow security-definer function avoids giving the application role a
-- BYPASSRLS connection or generic cross-tenant table access.
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
      (tenant_id, billing_period, external_uniq_id, amount_agorot, status)
    select d.tenant_id, d.next_charge_on,
           'caredesk-' || d.tenant_id::text || '-' || d.next_charge_on::text,
           d.price_agorot, 'processing'
      from due d
    on conflict (tenant_id, billing_period) do update
      set status = 'processing', attempts = product_billing_charge.attempts + 1,
          failure_code = null, updated_at = p_now
      where (
          product_billing_charge.status = 'failed'
          or (
            product_billing_charge.status = 'processing'
            and product_billing_charge.updated_at < p_now - interval '30 minutes'
          )
        )
        and product_billing_charge.attempts < 3
    returning *
  )
  select c.id, c.tenant_id, c.billing_period, c.external_uniq_id,
         c.amount_agorot, d.billing_name, d.billing_email,
         d.provider_setup_id, d.sealed_payment_token, d.card_expiry_month,
         d.card_expiry_year, d.card_last4
    from claimed c
    join due d on d.tenant_id = c.tenant_id
$$;

create or replace function complete_caredesk_product_billing_charge(
  p_charge_id uuid,
  p_provider_transaction_id text,
  p_now timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid;
  v_period date;
begin
  update public.product_billing_charge
     set status = 'succeeded', provider_transaction_id = p_provider_transaction_id,
         failure_code = null, updated_at = p_now
   where id = p_charge_id and status = 'processing'
   returning tenant_id, billing_period into v_tenant_id, v_period;
  if v_tenant_id is null then return; end if;
  update public.product_subscription
     set status = 'active', next_charge_on = (v_period + interval '1 month')::date,
         updated_at = p_now
   where tenant_id = v_tenant_id;
end
$$;

create or replace function fail_caredesk_product_billing_charge(
  p_charge_id uuid,
  p_failure_code text,
  p_now timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid;
begin
  update public.product_billing_charge
     set status = 'failed', failure_code = left(p_failure_code, 120), updated_at = p_now
   where id = p_charge_id and status = 'processing'
   returning tenant_id into v_tenant_id;
  if v_tenant_id is null then return; end if;
  update public.product_subscription
     set status = 'past_due', updated_at = p_now
   where tenant_id = v_tenant_id;
end
$$;

revoke all on function claim_caredesk_product_billing_charges(timestamptz, integer) from public;
revoke all on function find_caredesk_billing_setup_intent(uuid) from public;
revoke all on function complete_caredesk_product_billing_charge(uuid, text, timestamptz) from public;
revoke all on function fail_caredesk_product_billing_charge(uuid, text, timestamptz) from public;
grant execute on function claim_caredesk_product_billing_charges(timestamptz, integer) to caredesk_app;
grant execute on function find_caredesk_billing_setup_intent(uuid) to caredesk_app;
grant execute on function complete_caredesk_product_billing_charge(uuid, text, timestamptz) to caredesk_app;
grant execute on function fail_caredesk_product_billing_charge(uuid, text, timestamptz) to caredesk_app;

insert into schema_migrations (version) values ('0014_product_billing');

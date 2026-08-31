-- Root 8 — money becomes one model, and a due date stops depending on where the
-- server is racked.
--
-- Four defects, one cause: an amount and a date were conventions rather than
-- types, so every layer was free to hold its own version of them.
--
--   DOM-04. Payroll and forecasting carried floating-point shekels; product
--   billing carried integer agorot; between them sat a rounding helper
--   (`Math.round((amount + Number.EPSILON) * 100) / 100`) whose correction is
--   three orders of magnitude smaller than the error it was written to fix.
--   Rounding therefore happened at whichever layer touched the number first,
--   and the printed payslip and the stored row could differ by an agora,
--   repeatedly and unpredictably. Migration 0041 left a marker at
--   `caredesk_payroll_expected_total` saying this is where root 8 lands.
--
--   DOM-09. The application advertised a discounted price while the SQL that
--   claims due charges selected only `launch_discount_percent = 0` and billed
--   the UNDISCOUNTED price. A tenant on a 40% launch discount is shown a 60%
--   price and a next-charge date, is treated as needing payment, and is never
--   charged at all — indefinitely.
--
--   DOM-16. `next_charge_on = (v_period + interval '1 month')::date` clamps a
--   short month to its last valid day and then chains from the clamped value.
--   A subscription anchored on the 31st permanently migrates to the 28th after
--   its first February and charges two to three days early forever.
--
--   DOM-20. The weekly rest day was a compile-time constant (Saturday) in a
--   browser file, for a product whose entire user base employs foreign
--   caregivers who may lawfully choose Friday or Sunday. It becomes a stored,
--   per-case fact.
--
-- ADDITIVE ONLY. No column is dropped, no row is deleted, and no existing value
-- is rewritten. Every new column is nullable or carries a default that matches
-- how existing rows already behave. The one backfill below writes a NEW column
-- (`billing_anchor_day`) from values that are left exactly as they are, so it
-- is reversible by dropping the column.
--
-- WHAT HAPPENS TO ROWS WRITTEN BEFORE TODAY
-- -----------------------------------------
-- `payroll_entry` rows are unchanged and remain readable as they are. The new
-- reconciliation constraint is added NOT VALID, for the same reason 0041's was:
-- it governs every future write while leaving history alone, and validating it
-- against a customer's payroll history is a separate, deliberate act taken
-- after those rows have been reported on. Nothing is reinterpreted: agorot are
-- derived from the stored `numeric(12,2)` by exact decimal multiplication, so
-- a row that reconciled yesterday reconciles today, digit for digit.

-- ---------------------------------------------------------------------------
-- 1. The money type, in SQL.
-- ---------------------------------------------------------------------------

-- Exact decimal -> whole agorot. `round()` on numeric is half away from zero,
-- which is the rule packages/domain/src/money.ts implements and the ordinary
-- Israeli payroll convention. numeric is exact decimal, so this conversion is
-- not an approximation of the TypeScript one — it is the same arithmetic.
create function caredesk_agorot(amount numeric)
returns bigint
language sql
immutable
strict
parallel safe
as $$
  select round(amount * 100)::bigint
$$;

comment on function caredesk_agorot(numeric) is
  'Root 8 (DOM-04): the one conversion from stored decimal shekels to the integer-agorot money type. Half away from zero, matching packages/domain/src/money.ts.';

-- The jsonb additions column, summed in agorot. Elements whose `amount` is not
-- a JSON number contribute nothing here and are refused by
-- payroll_entry_additional_payments_shape (migration 0041), so the two can
-- never disagree about what the array is worth.
create function caredesk_payroll_additional_total_agorot(payments jsonb)
returns bigint
language sql
immutable
strict
parallel safe
as $$
  select coalesce(sum(caredesk_agorot((item ->> 'amount')::numeric)), 0)::bigint
  from jsonb_array_elements(payments) as item
  where jsonb_typeof(item -> 'amount') = 'number'
$$;

-- The one formula, in whole agorot, mirrored from
-- packages/domain/src/payroll.ts `calculateMonthlyPayrollAgorot`.
--
-- Compare this with `caredesk_payroll_expected_total` in migration 0041, which
-- it supersedes. That function needed four separate `round(…, 2)` calls, each
-- one a place where the database could disagree with the application about
-- where a half-agora goes; its own comment named that as the problem root 8
-- would remove. There is exactly one rounding step left here — a fractional
-- rest-day count times a daily rate — because integer addition needs none.
--
-- The 0041 constraint is deliberately NOT dropped. On `numeric(12,2)` columns
-- the two formulas are provably identical (every input already has at most two
-- decimal places, so each `round(…, 2)` is the identity and the aggregates
-- agree term by term), so keeping both costs nothing and means a rollback of
-- this migration's application code cannot leave the table unguarded.
create function caredesk_payroll_expected_total_agorot(
  base_salary numeric,
  paid_rest_days numeric,
  rest_day_rate numeric,
  holiday_pay numeric,
  vacation_pay numeric,
  sick_pay numeric,
  employer_contributions numeric,
  additional_payments jsonb,
  pocket_money numeric,
  deductions numeric,
  advances numeric,
  agreed_deductions numeric
)
returns bigint
language sql
immutable
strict
parallel safe
as $$
  select caredesk_agorot(base_salary)
       + round(caredesk_agorot(rest_day_rate) * paid_rest_days)::bigint
       + caredesk_agorot(holiday_pay)
       + caredesk_agorot(vacation_pay)
       + caredesk_agorot(sick_pay)
       + caredesk_agorot(employer_contributions)
       + caredesk_payroll_additional_total_agorot(additional_payments)
       - caredesk_agorot(pocket_money)
       - caredesk_agorot(deductions)
       - caredesk_agorot(advances)
       - caredesk_agorot(agreed_deductions)
$$;

alter table payroll_entry
  add constraint payroll_entry_total_reconciles_agorot
    check (caredesk_agorot(total) = caredesk_payroll_expected_total_agorot(
      base_salary, paid_rest_days, rest_day_rate, holiday_pay, vacation_pay,
      sick_pay, employer_contributions, additional_payments, pocket_money,
      deductions, advances, agreed_deductions))
    not valid;

-- ---------------------------------------------------------------------------
-- 2. DOM-16 — the billing anniversary stops drifting.
-- ---------------------------------------------------------------------------

alter table product_subscription
  add column if not exists billing_anchor_day smallint;

alter table product_subscription
  add constraint product_subscription_billing_anchor_day_range
    check (billing_anchor_day is null or billing_anchor_day between 1 and 31);

comment on column product_subscription.billing_anchor_day is
  'The intended day of the month for the monthly charge (DOM-16). next_charge_on is computed from this each period, so a short February clamps once and the anniversary returns to 29/30/31 the following month instead of migrating permanently.';

-- Backfill the new column only. `charging_starts_at` is the day the schedule
-- was set up and has never been advanced by the buggy arithmetic, so it is the
-- better evidence of the original intent; `next_charge_on` may already carry a
-- clamped 28. Neither source column is modified. This mirrors
-- `inferAnchorDay` in packages/domain/src/billing-schedule.ts.
--
-- A subscription that already drifted to the 28th and whose charging_starts_at
-- was itself the 28th stays on the 28th: this migration stops the drift, it
-- does not retroactively decide that a customer meant something other than
-- what their setup date says. Reversing a drift that already happened is a
-- customer-facing decision, not a schema one.
update product_subscription
   set billing_anchor_day = extract(day from coalesce(charging_starts_at, next_charge_on))::smallint
 where billing_anchor_day is null
   and coalesce(charging_starts_at, next_charge_on) is not null;

-- The anchored advance. `date_trunc` to the first of the target month, then
-- clamp the anchor day to that month's length — so 31 January advances to
-- 28 February and then back to 31 March, which chaining from the clamped value
-- can never do.
create function caredesk_next_charge_on(period date, anchor_day smallint)
returns date
language sql
immutable
parallel safe
as $$
  select (date_trunc('month', period) + interval '1 month')::date
       + (least(
            coalesce(anchor_day, extract(day from period)::smallint),
            extract(day from (date_trunc('month', period) + interval '2 month' - interval '1 day'))::smallint
          ) - 1)
$$;

comment on function caredesk_next_charge_on(date, smallint) is
  'DOM-16: the next monthly charge date, anchored on the subscription''s intended day-of-month rather than chained from the previous (possibly clamped) charge.';

-- ---------------------------------------------------------------------------
-- 3. DOM-09 — a partial discount is charged, not silently skipped.
-- ---------------------------------------------------------------------------

-- The one definition of what a subscription actually costs per month. Integer
-- arithmetic on the numeric type, identical to `effectivePriceAgorot` in
-- packages/domain/src/billing-schedule.ts: multiply first, divide by 100, round
-- half away from zero. A 100% discount yields 0, which is a sponsored account
-- with nothing to collect — the one case the old `launch_discount_percent = 0`
-- filter accidentally got right out of the 101 possible values.
create function caredesk_effective_price_agorot(price_agorot integer, discount_percent integer)
returns integer
language sql
immutable
strict
parallel safe
as $$
  select round(price_agorot::numeric * (100 - discount_percent) / 100.0)::integer
$$;

comment on function caredesk_effective_price_agorot(integer, integer) is
  'DOM-09: the amount actually charged for one month. The billing page and the collection job now compute it from here, so the displayed price and the charged price cannot disagree.';

-- Rebuilt claim function. Signature and result columns are unchanged, so the
-- deployed API keeps working across the rollout.
--
-- Two behavioural changes, both DOM-09/DOM-16:
--   * the `launch_discount_percent = 0` filter becomes
--     `caredesk_effective_price_agorot(...) > 0`, so a 40%-discounted tenant is
--     charged 60% instead of being charged nothing while being told otherwise,
--     and a fully sponsored tenant is still skipped;
--   * the claimed `amount_agorot` is the effective price, not `price_agorot`.
--
-- A charge row that already exists for (tenant, period) keeps its stored
-- amount: `on conflict do update` deliberately does not touch amount_agorot, so
-- a retry of an in-flight period bills what it was claimed at rather than
-- silently repricing an attempt that is already with the provider.
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
       and caredesk_effective_price_agorot(s.price_agorot, s.launch_discount_percent) > 0
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
           caredesk_effective_price_agorot(d.price_agorot, d.launch_discount_percent),
           'processing', d.payment_method_updated_at
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
            excluded.payment_method_refreshed_at is not null
            and (
              product_billing_charge.payment_method_refreshed_at is null
              or excluded.payment_method_refreshed_at > product_billing_charge.payment_method_refreshed_at
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

-- Settlement advances next_charge_on from the ANCHOR, not from the period it
-- just billed (DOM-16).
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
     set status = 'active',
         next_charge_on = caredesk_next_charge_on(v_period, billing_anchor_day),
         updated_at = p_now
   where tenant_id = v_tenant_id;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. DOM-20 — the weekly rest day becomes a stored fact.
-- ---------------------------------------------------------------------------

alter table employment_case
  add column if not exists weekly_rest_day smallint;

alter table employment_case
  add constraint employment_case_weekly_rest_day_range
    check (weekly_rest_day is null or weekly_rest_day in (0, 5, 6));

comment on column employment_case.weekly_rest_day is
  'The employee''s chosen weekly rest day as Date.getUTCDay() numbers it: 0 Sunday, 5 Friday, 6 Saturday (DOM-20). NULL means unstated — deliberately not defaulted to Saturday, because that default is exactly what this column exists to stop being invisible. Proration must refuse to run rather than guess.';

-- ---------------------------------------------------------------------------
-- 5. Grants. Postgres grants EXECUTE on a new function to PUBLIC by default.
-- This has been the same mistake five times in this schema; the revoke is not
-- optional. caredesk_app needs EXECUTE on the CHECK-constraint functions
-- because a constraint's function runs as the role performing the write.
-- ---------------------------------------------------------------------------

revoke all privileges on function caredesk_agorot(numeric) from public;
revoke all privileges on function caredesk_payroll_additional_total_agorot(jsonb) from public;
revoke all privileges on function caredesk_payroll_expected_total_agorot(
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb,
  numeric, numeric, numeric, numeric) from public;
revoke all privileges on function caredesk_next_charge_on(date, smallint) from public;
revoke all privileges on function caredesk_effective_price_agorot(integer, integer) from public;

grant execute on function caredesk_agorot(numeric) to caredesk_app;
grant execute on function caredesk_payroll_additional_total_agorot(jsonb) to caredesk_app;
grant execute on function caredesk_payroll_expected_total_agorot(
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb,
  numeric, numeric, numeric, numeric) to caredesk_app;

-- caredesk_next_charge_on and caredesk_effective_price_agorot are called only
-- from inside SECURITY DEFINER functions owned by the schema owner, so
-- caredesk_app deliberately gets no direct grant on either: the price a
-- customer is charged is not something the application role should be able to
-- evaluate ad hoc.

insert into schema_migrations (version) values ('0045_money_is_a_model');

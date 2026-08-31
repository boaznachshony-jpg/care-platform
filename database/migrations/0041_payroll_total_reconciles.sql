-- Root 4 — the database stops trusting the browser about money.
--
-- Two holes, both on the row a family would show a labour inspector:
--
--   DOM-02 / DB-06. `payroll_entry.total` came straight from the request body
--   and was inserted verbatim. `payroll_entry` had per-column range checks and
--   no reconciliation constraint, so `{base_salary: 6000, advances: 5000,
--   total: 6000}` stored a canonical record claiming 6,000 was owed while its
--   own components said 1,000. The same team applied exactly this protection to
--   `payroll_month_close` in migration 0026 and not to the entry it derives
--   from. This migration adds the missing half.
--
--   DOM-01. `payroll_month_close` is append-only, but the facts it certifies
--   were not frozen with it. July could be closed at 6,200 on 5 August and
--   edited to 5,000 on the 20th; the receipt, the timeline and the entry then
--   disagreed permanently with nothing to reconcile them. The API now refuses
--   it, and this trigger is what makes that true for every future write path
--   rather than for the one that happens to check.
--
-- ADDITIVE ONLY: no column dropped, no row deleted, no value rewritten. The
-- reconciliation constraint is added NOT VALID on purpose — it governs every
-- future write while leaving whatever is already stored exactly as it is. Rows
-- written before today were never checked against anything and this migration
-- is not the place to discover, in a single ACCESS EXCLUSIVE lock on a
-- customer's payroll history, that some of them do not reconcile. Running
-- `validate constraint` against the two constraints below is a separate,
-- deliberate act, after the existing rows have been reported on.

-- The jsonb additions column, summed. A CHECK constraint cannot contain a
-- subquery or a set-returning function, so `jsonb_array_elements` has to be
-- wrapped. Elements whose `amount` is not a JSON number contribute nothing
-- here and are refused by payroll_entry_additional_payments_shape below, so the
-- two can never disagree about what the array is worth.
create function caredesk_payroll_additional_total(payments jsonb)
returns numeric
language sql
immutable
strict
parallel safe
as $$
  select coalesce(sum((item ->> 'amount')::numeric), 0)
  from jsonb_array_elements(payments) as item
  where jsonb_typeof(item -> 'amount') = 'number'
$$;

create function caredesk_payroll_additional_payments_well_formed(payments jsonb)
returns boolean
language sql
immutable
strict
parallel safe
as $$
  select not exists (
    select 1
    from jsonb_array_elements(payments) as item
    where jsonb_typeof(item -> 'amount') <> 'number'
       or (item ->> 'amount')::numeric < 0
  )
$$;

-- The one formula, mirrored from packages/domain/src/payroll.ts. Rounding is
-- applied once per aggregate, in the same places and in the same order, so the
-- constraint agrees with the value the API computes rather than merely being
-- near it. `round()` on numeric is half-away-from-zero, which is the rule
-- `roundShekels` implements in TypeScript.
--
-- ROOT 8 LANDS HERE. When money becomes a single integer-agorot type, these
-- arguments become bigint agorot, every `round(…, 2)` disappears, and the
-- rounding-agreement problem this function exists to solve stops existing.
create function caredesk_payroll_expected_total(
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
returns numeric
language sql
immutable
strict
parallel safe
as $$
  select round(base_salary, 2)
       + round(
           round(paid_rest_days * rest_day_rate, 2)
           + holiday_pay + vacation_pay + sick_pay + employer_contributions
           + caredesk_payroll_additional_total(additional_payments),
           2)
       - round(pocket_money + deductions + advances + agreed_deductions, 2)
$$;

alter table payroll_entry
  add constraint payroll_entry_additional_payments_shape
    check (caredesk_payroll_additional_payments_well_formed(additional_payments))
    not valid;

alter table payroll_entry
  add constraint payroll_entry_total_reconciles
    check (total = caredesk_payroll_expected_total(
      base_salary, paid_rest_days, rest_day_rate, holiday_pay, vacation_pay,
      sick_pay, employer_contributions, additional_payments, pocket_money,
      deductions, advances, agreed_deductions))
    not valid;

-- DOM-01. Deliberately NOT security definer: the function reads
-- payroll_month_close as the invoking role, which is caredesk_app under forced
-- RLS with app.tenant_id set, so a closed month in another tenant is invisible
-- here exactly as it is everywhere else. A definer-rights trigger would run
-- with the owner's BYPASSRLS and read across tenants to decide a write.
create function caredesk_payroll_entry_month_not_closed()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from payroll_month_close c
    where c.tenant_id = new.tenant_id
      and c.employment_case_id = new.employment_case_id
      and c.payroll_month = new.payroll_month
  ) then
    raise exception 'payroll_month_closed'
      using detail = 'A payroll month with a close receipt is immutable.',
            hint = 'Corrections require a governed reopen path, which does not exist yet.';
  end if;
  return new;
end;
$$;

create trigger payroll_entry_month_not_closed
  before insert or update on payroll_entry
  for each row
  execute function caredesk_payroll_entry_month_not_closed();

-- DOM-24. `check (total_amount > 0)` from migration 0026 made a legitimate
-- month impossible to close: one where the caregiver was absent unpaid (total
-- 0), or where advances exceeded salary (total negative, which
-- `payroll_entry.total between -10000000 and 10000000` has always permitted).
-- Those months stayed open forever and `hasOpenMonth` nagged about them with no
-- resolution available to the user. The range now matches the entry the close
-- certifies. This widens a constraint; it drops no column, deletes no row and
-- rewrites no value, and every existing row satisfies the wider rule by
-- construction because it satisfied the narrower one.
alter table payroll_month_close
  drop constraint if exists payroll_month_close_total_amount_check;
alter table payroll_month_close
  add constraint payroll_month_close_total_amount_range
    check (total_amount is null or total_amount between -10000000 and 10000000);

-- Postgres grants EXECUTE on a new function to PUBLIC by default. This has been
-- the same mistake three times in this repository; the revoke is not optional.
-- caredesk_app needs EXECUTE because a CHECK constraint's function runs as the
-- role performing the write.
revoke all privileges on function caredesk_payroll_additional_total(jsonb) from public;
revoke all privileges on function caredesk_payroll_additional_payments_well_formed(jsonb) from public;
revoke all privileges on function caredesk_payroll_expected_total(
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb,
  numeric, numeric, numeric, numeric) from public;
revoke all privileges on function caredesk_payroll_entry_month_not_closed() from public;

grant execute on function caredesk_payroll_additional_total(jsonb) to caredesk_app;
grant execute on function caredesk_payroll_additional_payments_well_formed(jsonb) to caredesk_app;
grant execute on function caredesk_payroll_expected_total(
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb,
  numeric, numeric, numeric, numeric) to caredesk_app;
grant execute on function caredesk_payroll_entry_month_not_closed() to caredesk_app;

insert into schema_migrations (version) values ('0041_payroll_total_reconciles');

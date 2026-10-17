-- Close the direct-SQL gaps without touching historical payroll or receipts.
-- Application DELETE is already denied; this guard also freezes OLD identity
-- before an UPDATE can move a closed entry into a different case/month.
create function caredesk_payroll_closed_entry_immutable()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'payroll-month:' || old.tenant_id::text || ':' || old.employment_case_id::text || ':' || to_char(old.payroll_month, 'YYYY-MM'), 0));
  if exists (
    select 1 from payroll_month_close c
    where c.tenant_id = old.tenant_id and c.employment_case_id = old.employment_case_id
      and c.payroll_month = old.payroll_month
  ) then
    raise exception 'payroll_month_closed'
      using errcode = '23514', constraint = 'payroll_closed_entry_immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger payroll_closed_entry_immutable
  before update or delete on payroll_entry for each row
  execute function caredesk_payroll_closed_entry_immutable();

-- The ledger's case, month and entry must identify the same aggregate. NOT VALID
-- leaves old evidence unchanged and enforces every new or changed relationship.
alter table payroll_entry add constraint payroll_entry_case_identity_unique
  unique (tenant_id, employment_case_id, id, payroll_month);
alter table payroll_payment_event add constraint payroll_payment_event_case_entry_month
  foreign key (tenant_id, employment_case_id, payroll_entry_id, applies_to_month)
  references payroll_entry (tenant_id, employment_case_id, id, payroll_month) not valid;

create function caredesk_payroll_payment_event_has_context()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'payroll-month:' || new.tenant_id::text || ':' || new.employment_case_id::text || ':' || to_char(new.applies_to_month, 'YYYY-MM'), 0));
  if not exists (
    select 1 from payroll_entry e
    cross join lateral jsonb_array_elements(coalesce(e.calculation_context -> 'paymentEvents', '[]'::jsonb)) fact
    where e.tenant_id = new.tenant_id and e.employment_case_id = new.employment_case_id
      and e.id = new.payroll_entry_id and e.payroll_month = new.applies_to_month
      and fact ->> 'id' = new.event_key and (fact ->> 'date')::date = new.event_date
      and ((fact ->> 'appliesToMonth') || '-01')::date = new.applies_to_month
      and fact ->> 'kind' = new.payment_kind and (fact ->> 'amount')::numeric = new.amount
  ) then
    raise exception 'payroll_payment_event_conflict'
      using errcode = '23514', constraint = 'payroll_payment_event_conflict';
  end if;
  return new;
end;
$$;
create trigger payroll_payment_event_has_context
  before insert on payroll_payment_event for each row
  execute function caredesk_payroll_payment_event_has_context();

-- Recorded payments cannot disappear from a later draft revision. A future
-- explicit reversal workflow can add evidence; silent deletion cannot undo cash.
-- A positive payment receipt certifies payment, not an unpaid remainder, so it
-- must never be reused as a positive carry entitlement for another month.
create function caredesk_payroll_preserve_settlement_sources()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'payroll-month:' || new.tenant_id::text || ':' || new.employment_case_id::text || ':' || to_char(new.payroll_month, 'YYYY-MM'), 0));
  if coalesce((new.calculation_context #>> '{openingBalance,amount}')::numeric, 0) > 0 then
    raise exception 'payroll_carry_source_mismatch'
      using errcode = '23514', constraint = 'payroll_carry_source_mismatch';
  end if;
  if tg_op = 'UPDATE' and exists (
    select 1 from payroll_payment_event p
    where p.tenant_id = old.tenant_id and p.payroll_entry_id = old.id
      and not exists (
        select 1 from jsonb_array_elements(coalesce(new.calculation_context -> 'paymentEvents', '[]'::jsonb)) fact
        where fact ->> 'id' = p.event_key and (fact ->> 'date')::date = p.event_date
          and ((fact ->> 'appliesToMonth') || '-01')::date = p.applies_to_month
          and p.applies_to_month = new.payroll_month
          and fact ->> 'kind' = p.payment_kind and (fact ->> 'amount')::numeric = p.amount
      )
  ) then
    raise exception 'payroll_payment_event_conflict'
      using errcode = '23514', constraint = 'payroll_payment_event_conflict';
  end if;
  return new;
end;
$$;
create trigger payroll_context_integrity
  before insert or update on payroll_entry for each row
  execute function caredesk_payroll_preserve_settlement_sources();

create function caredesk_payroll_close_no_paid_positive_carry()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.opening_balance_amount, 0) > 0 then
    raise exception 'payroll_carry_source_mismatch'
      using errcode = '23514', constraint = 'payroll_carry_source_mismatch';
  end if;
  return new;
end;
$$;
create trigger payroll_close_no_paid_positive_carry
  before insert on payroll_month_close for each row
  execute function caredesk_payroll_close_no_paid_positive_carry();

-- A policy snapshot is derived by the database, never accepted on the caller's
-- word. The reviewed versions are immutable; retirement affects NEW writes only.
-- Closing a saved entry does not look up live rules or recalculate historical pay.
create function caredesk_payroll_context_policy_snapshot()
returns trigger
language plpgsql
as $$
declare
  reference record;
  policy payroll_policy_rule%rowtype;
  snapshots jsonb := '[]'::jsonb;
  included_ids text[] := array[]::text[];
  month_start date := new.payroll_month;
  month_end date := (new.payroll_month + interval '1 month - 1 day')::date;
begin
  for reference in
    select value ->> 'ruleId' as rule_key,
      greatest((value ->> 'from')::date, month_start) as from_date,
      least((value ->> 'to')::date, month_end) as to_date
      from jsonb_array_elements(coalesce(new.calculation_context -> 'salaryPeriods', '[]'::jsonb))
      where (value ->> 'from')::date <= month_end and (value ->> 'to')::date >= month_start
    union all
    select value ->> 'ruleId', (value ->> 'date')::date, (value ->> 'date')::date
      from jsonb_array_elements(coalesce(new.calculation_context -> 'dayFacts', '[]'::jsonb))
    union all
    select value ->> 'ruleId', month_start, month_start
      from jsonb_array_elements(coalesce(new.calculation_context -> 'deductionItems', '[]'::jsonb))
    union all
    select new.calculation_context #>> '{openingBalance,ruleId}', month_start, month_start
      where new.calculation_context -> 'openingBalance' is not null
  loop
    select * into policy from payroll_policy_rule r
      where r.tenant_id = new.tenant_id and r.id::text = reference.rule_key
        and r.status = 'active' and r.effective_from <= reference.from_date
        and (r.effective_to is null or r.effective_to >= reference.to_date)
        and r.source_reference is not null and length(trim(r.source_reference)) > 0
        and r.source_verified_at is not null and r.source_verified_at <= now()
        and r.reviewed_by is not null and r.approved_at is not null
        and r.approved_at >= r.source_verified_at and r.approved_at <= now();
    if not found then
      raise exception 'payroll_context_policy_unavailable'
        using errcode = '23514', constraint = 'payroll_context_policy_unavailable';
    end if;
    if not policy.id::text = any(included_ids) then
      included_ids := array_append(included_ids, policy.id::text);
      snapshots := snapshots || jsonb_build_array(jsonb_build_object(
        'id', policy.id::text, 'code', trim(policy.code), 'version', policy.version,
        'status', 'active', 'effectiveFrom', policy.effective_from::text,
        'effectiveTo', policy.effective_to::text, 'sourceReference', trim(policy.source_reference),
        'sourceVerifiedAt', to_char(policy.source_verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'reviewedBy', policy.reviewed_by::text,
        'approvedAt', to_char(policy.approved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'config', policy.config
      ));
    end if;
  end loop;
  new.calculation_policy_snapshot := snapshots;
  return new;
end;
$$;
create trigger payroll_context_policy_snapshot
  before insert or update on payroll_entry for each row
  execute function caredesk_payroll_context_policy_snapshot();

revoke all privileges on function caredesk_payroll_closed_entry_immutable() from public;
revoke all privileges on function caredesk_payroll_payment_event_has_context() from public;
revoke all privileges on function caredesk_payroll_context_policy_snapshot() from public;
revoke all privileges on function caredesk_payroll_preserve_settlement_sources() from public;
revoke all privileges on function caredesk_payroll_close_no_paid_positive_carry() from public;
grant execute on function caredesk_payroll_closed_entry_immutable() to caredesk_app;
grant execute on function caredesk_payroll_payment_event_has_context() to caredesk_app;
grant execute on function caredesk_payroll_context_policy_snapshot() to caredesk_app;
grant execute on function caredesk_payroll_preserve_settlement_sources() to caredesk_app;
grant execute on function caredesk_payroll_close_no_paid_positive_carry() to caredesk_app;

insert into schema_migrations (version) values ('0051_payroll_context_integrity');

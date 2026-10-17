-- Approved RULE-09/10/12. Historical totals and immutable receipts retain their meaning.
alter table payroll_entry
  add column calculation_context jsonb
    check (calculation_context is null or jsonb_typeof(calculation_context) = 'object'),
  add column calculation_policy_snapshot jsonb not null default '[]'::jsonb
    check (jsonb_typeof(calculation_policy_snapshot) = 'array');

create unique index payroll_entry_carry_source_once
  on payroll_entry (tenant_id, employment_case_id, (lower(calculation_context #>> '{openingBalance,reference}')))
  where calculation_context #>> '{openingBalance,reference}' is not null;

-- Event identity survives draft corrections and cannot be deducted twice in
-- different months or relabelled from pocket money to advance under the same id.
create table payroll_payment_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  payroll_entry_id uuid not null,
  event_key text not null check (length(trim(event_key)) between 1 and 160),
  event_date date not null,
  applies_to_month date not null check (applies_to_month = date_trunc('month', applies_to_month)::date),
  payment_kind text not null check (payment_kind in ('advance', 'pocket_money')),
  amount numeric(12,2) not null check (amount between 0 and 10000000),
  created_at timestamptz not null default now(),
  constraint payroll_payment_event_once unique (tenant_id, employment_case_id, event_key),
  constraint payroll_payment_event_case_same_tenant foreign key (tenant_id, employment_case_id)
    references employment_case (tenant_id, id),
  constraint payroll_payment_event_entry_same_tenant foreign key (tenant_id, payroll_entry_id)
    references payroll_entry (tenant_id, id)
);
alter table payroll_payment_event enable row level security;
alter table payroll_payment_event force row level security;
create policy payroll_payment_event_tenant_isolation on payroll_payment_event
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
grant select, insert on payroll_payment_event to caredesk_app;

create function caredesk_payroll_record_payment_events()
returns trigger
language plpgsql
as $$
declare
  event jsonb;
begin
  for event in select value from jsonb_array_elements(coalesce(new.calculation_context -> 'paymentEvents', '[]'::jsonb))
  loop
    insert into payroll_payment_event (tenant_id,employment_case_id,payroll_entry_id,event_key,event_date,applies_to_month,payment_kind,amount)
      values (new.tenant_id,new.employment_case_id,new.id,event ->> 'id',(event ->> 'date')::date,
        ((event ->> 'appliesToMonth') || '-01')::date,event ->> 'kind',(event ->> 'amount')::numeric)
      on conflict (tenant_id,employment_case_id,event_key) do nothing;
    if not exists (
      select 1 from payroll_payment_event p
      where p.tenant_id = new.tenant_id and p.employment_case_id = new.employment_case_id
        and p.event_key = event ->> 'id' and p.payroll_entry_id = new.id
        and p.event_date = (event ->> 'date')::date
        and p.applies_to_month = new.payroll_month
        and p.applies_to_month = ((event ->> 'appliesToMonth') || '-01')::date
        and p.payment_kind = event ->> 'kind' and p.amount = (event ->> 'amount')::numeric
    ) then
      raise exception 'payroll_payment_event_conflict'
        using errcode = '23514', constraint = 'payroll_payment_event_conflict';
    end if;
  end loop;
  return new;
end;
$$;
create trigger payroll_record_payment_events
  after insert or update on payroll_entry for each row
  execute function caredesk_payroll_record_payment_events();
revoke all privileges on function caredesk_payroll_record_payment_events() from public;
grant execute on function caredesk_payroll_record_payment_events() to caredesk_app;

alter table payroll_month_close
  add column settlement_basis text not null default 'legacy_total'
    check (settlement_basis in ('legacy_total', 'worker')),
  add column payroll_entry_id uuid,
  add column payroll_version integer check (payroll_version > 0),
  add column calculation_total numeric(12,2),
  add column employer_contributions_amount numeric(12,2)
    check (employer_contributions_amount between 0 and 10000000),
  add column opening_balance_amount numeric(12,2),
  add constraint payroll_close_entry_same_tenant
    foreign key (tenant_id, payroll_entry_id) references payroll_entry (tenant_id, id),
  add constraint payroll_close_worker_settlement check (
    settlement_basis = 'legacy_total'
    or (payroll_entry_id is not null and payroll_version is not null
      and calculation_total is not null and employer_contributions_amount is not null
      and opening_balance_amount is not null and total_amount is not null
      and total_amount = calculation_total - employer_contributions_amount + opening_balance_amount)
  );

-- The API takes this same transaction lock before reading either aggregate.
-- A row lock alone cannot serialize a first create against another first create.
create or replace function caredesk_payroll_entry_month_not_closed()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'payroll-month:' || new.tenant_id::text || ':' || new.employment_case_id::text || ':' || to_char(new.payroll_month, 'YYYY-MM'), 0));
  if exists (
    select 1 from payroll_month_close c
    where c.tenant_id = new.tenant_id
      and c.employment_case_id = new.employment_case_id
      and c.payroll_month = new.payroll_month
  ) then
    raise exception 'payroll_month_closed'
      using errcode = 'P0001', detail = 'A payroll month with a close receipt is immutable.';
  end if;
  if new.calculation_context -> 'openingBalance' is not null then
    if not exists (
      select 1 from payroll_month_close c
      where c.tenant_id = new.tenant_id and c.employment_case_id = new.employment_case_id
        and c.payroll_month < new.payroll_month
        and to_char(c.payroll_month, 'YYYY-MM') = new.calculation_context #>> '{openingBalance,sourceMonth}'
        and c.payroll_entry_id::text = lower(new.calculation_context #>> '{openingBalance,reference}')
        and c.payroll_version = (new.calculation_context #>> '{openingBalance,sourceVersion}')::integer
        and c.settlement_basis = 'worker'
        and c.total_amount = (new.calculation_context #>> '{openingBalance,amount}')::numeric
    ) then
      raise exception 'payroll_carry_source_mismatch' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- Old rows remain legacy_total. Every newly inserted receipt certifies a final,
-- versioned canonical entry and stores the worker settlement separately from cost.
create function caredesk_payroll_close_matches_entry()
returns trigger
language plpgsql
as $$
declare
  entry payroll_entry%rowtype;
  deductions_total numeric;
  opening_balance numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'payroll-month:' || new.tenant_id::text || ':' || new.employment_case_id::text || ':' || to_char(new.payroll_month, 'YYYY-MM'), 0));
  if new.settlement_basis <> 'worker' then
    raise exception 'canonical_payroll_required' using errcode = 'P0001';
  end if;
  select * into entry from payroll_entry e
    where e.tenant_id = new.tenant_id and e.employment_case_id = new.employment_case_id
      and e.payroll_month = new.payroll_month and e.id = new.payroll_entry_id
    for update;
  if not found or new.payroll_reference <> entry.id::text then
    raise exception 'payroll_reference_not_found' using errcode = 'P0001';
  end if;
  if entry.status <> 'final' then
    raise exception 'payroll_final_required' using errcode = 'P0001';
  end if;
  if new.payroll_version is distinct from entry.version then
    raise exception 'version_conflict' using errcode = 'P0001';
  end if;
  deductions_total := entry.pocket_money + entry.deductions + entry.advances + entry.agreed_deductions;
  opening_balance := coalesce((entry.calculation_context #>> '{openingBalance,amount}')::numeric, 0);
  if new.calculation_total is distinct from entry.total
    or new.employer_contributions_amount is distinct from entry.employer_contributions
    or new.opening_balance_amount is distinct from opening_balance
    or new.total_amount is distinct from (entry.total - entry.employer_contributions + opening_balance)
    or new.base_salary_amount is distinct from entry.base_salary
    or new.deductions_amount is distinct from (deductions_total + greatest(-opening_balance, 0))
    or new.additions_amount is distinct from (entry.total - entry.base_salary + deductions_total - entry.employer_contributions + greatest(opening_balance, 0))
  then
    raise exception 'payroll_close_amount_mismatch' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger payroll_close_matches_entry
  before insert on payroll_month_close for each row
  execute function caredesk_payroll_close_matches_entry();

revoke all privileges on function caredesk_payroll_entry_month_not_closed() from public;
revoke all privileges on function caredesk_payroll_close_matches_entry() from public;
grant execute on function caredesk_payroll_entry_month_not_closed() to caredesk_app;
grant execute on function caredesk_payroll_close_matches_entry() to caredesk_app;

insert into schema_migrations (version) values ('0049_payroll_settlement_integrity');

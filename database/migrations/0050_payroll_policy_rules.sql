-- Numeric employment policies have their own governed, tenant-isolated store.
-- No seed is an active legal rule. The application can READ only: approval and
-- policy publication require the existing reviewed administrative process.
create table payroll_policy_rule (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  code text not null check (length(trim(code)) between 1 and 160),
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft','under_review','active','suspended','retired')),
  effective_from date not null,
  effective_to date check (effective_to is null or effective_to >= effective_from),
  source_reference text,
  source_verified_at timestamptz,
  reviewed_by uuid,
  approved_at timestamptz,
  config jsonb not null check (jsonb_typeof(config) = 'object' and config ->> 'kind' in ('proration','day','deduction','carry')),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint payroll_policy_rule_version_unique unique (tenant_id, code, version),
  constraint payroll_policy_rule_tenant_unique unique (tenant_id, id),
  constraint payroll_policy_rule_active_reviewed check (
    status <> 'active' or (
      source_reference is not null and length(trim(source_reference)) > 0
      and source_verified_at is not null and reviewed_by is not null and approved_at is not null
      and approved_at >= source_verified_at
    )
  )
);
create index payroll_policy_rule_effective on payroll_policy_rule (tenant_id,status,effective_from,effective_to);
alter table payroll_policy_rule enable row level security;
alter table payroll_policy_rule force row level security;
create policy payroll_policy_rule_tenant_isolation on payroll_policy_rule
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
revoke all privileges on payroll_policy_rule from public;
grant select on payroll_policy_rule to caredesk_app;
comment on table payroll_policy_rule is 'Server-owned numeric payroll policy versions. No client write/activation. Missing reviewed effective policy means review required, never guessed entitlement.';

-- An activated version is an immutable historical definition. Retirement only
-- changes availability for NEW calculations; it cannot rewrite old evidence.
create function protect_payroll_policy_version() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.activated_at is not null then
      raise exception 'Activated payroll policy versions cannot be deleted' using errcode = '23514';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.activated_at is not null then
    if (new.id,new.tenant_id,new.code,new.version,new.effective_from,new.effective_to,
        new.source_reference,new.source_verified_at,new.reviewed_by,new.approved_at,new.config,new.activated_at,new.created_at)
       is distinct from
       (old.id,old.tenant_id,old.code,old.version,old.effective_from,old.effective_to,
        old.source_reference,old.source_verified_at,old.reviewed_by,old.approved_at,old.config,old.activated_at,old.created_at) then
      raise exception 'Publish a new payroll policy version instead of editing historical rules' using errcode = '23514';
    end if;
    if new.status not in ('active','suspended','retired') then
      raise exception 'An activated payroll policy cannot return to draft' using errcode = '23514';
    end if;
  end if;
  if new.status = 'active' then
    new.activated_at := coalesce(new.activated_at, now());
    -- Serialize publication per tenant/code to avoid overlapping active
    -- versions in concurrent administrative transactions.
    perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || new.code, 0));
    if exists (
      select 1 from payroll_policy_rule r
       where r.tenant_id = new.tenant_id and r.code = new.code and r.status = 'active'
         and r.id <> new.id
         and daterange(r.effective_from,r.effective_to,'[]') && daterange(new.effective_from,new.effective_to,'[]')
    ) then
      raise exception 'Active payroll policy effective ranges overlap' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all privileges on function protect_payroll_policy_version() from public;
create trigger payroll_policy_rule_protect_version before insert or update or delete on payroll_policy_rule
  for each row execute function protect_payroll_policy_version();
insert into schema_migrations(version) values ('0050_payroll_policy_rules');

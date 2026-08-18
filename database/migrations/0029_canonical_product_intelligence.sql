-- Canonical financial facts needed to reconstruct closed-month actuals. These
-- values are an immutable close snapshot, not a payroll calculation engine.
-- Note: renamed from 0026_canonical_product_intelligence to avoid duplicate prefix.
alter table payroll_month_close
  add column if not exists total_amount numeric(12,2) check (total_amount > 0),
  add column if not exists base_salary_amount numeric(12,2) check (base_salary_amount >= 0),
  add column if not exists additions_amount numeric(12,2) check (additions_amount >= 0),
  add column if not exists deductions_amount numeric(12,2) check (deductions_amount >= 0);

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'payroll_month_close'::regclass
    and conname = 'payroll_month_close_amount_reconciles'
  ) then
    alter table payroll_month_close
      add constraint payroll_month_close_amount_reconciles check (
        (total_amount is null and base_salary_amount is null and additions_amount is null and deductions_amount is null)
        or total_amount = base_salary_amount + additions_amount - deductions_amount
      );
  end if;
end; $$;

insert into schema_migrations (version) values ('0029_canonical_product_intelligence');

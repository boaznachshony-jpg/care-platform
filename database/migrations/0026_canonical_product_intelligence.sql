-- Canonical financial facts needed to reconstruct closed-month actuals. These
-- values are an immutable close snapshot, not a payroll calculation engine.
alter table payroll_month_close
  add column total_amount numeric(12,2) check (total_amount > 0),
  add column base_salary_amount numeric(12,2) check (base_salary_amount >= 0),
  add column additions_amount numeric(12,2) check (additions_amount >= 0),
  add column deductions_amount numeric(12,2) check (deductions_amount >= 0),
  add constraint payroll_month_close_amount_reconciles check (
    (total_amount is null and base_salary_amount is null and additions_amount is null and deductions_amount is null)
    or total_amount = base_salary_amount + additions_amount - deductions_amount
  );

insert into schema_migrations (version) values ('0026_canonical_product_intelligence');

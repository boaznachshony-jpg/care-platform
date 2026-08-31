-- Recorded acceptance of the terms of service and the privacy policy.
--
-- WHAT WAS MISSING
-- ----------------
-- The product had billing terms at /terms/subscription and a consent checkbox
-- on the billing screen, and the checkbox was `useState` and nothing else. The
-- box was ticked, the subscription was created, and no trace of the acceptance
-- survived the page. `product_subscription.terms_version` (0014) records which
-- billing-terms version was current when a payment method was attached - it is
-- a property of the subscription, not a record that a named person agreed to a
-- named document at a named moment, and it says nothing at all about the
-- privacy policy, which is the document that matters most here.
--
-- It matters most because of what this product holds. The account holder does
-- not enter their own data; they enter a third party's - the caregiver's
-- identity documents, visa status, payroll and medication records. Under the
-- Israeli Privacy Protection Law the question "on what basis was this person's
-- data entered, and who said so, and when" has to have an answer, and the
-- answer cannot be a checkbox that left no evidence.
--
-- WHY THIS IS EVIDENCE, AND WHAT THAT IMPLIES
-- -------------------------------------------
-- An acceptance row is a claim about the past. The grant below is therefore
-- `select, insert` and nothing else. There is deliberately no UPDATE grant and
-- no DELETE grant: a record that the application can rewrite is not evidence of
-- anything, and "the row said the customer accepted v2" is worthless if the
-- same code path could have written it yesterday. This follows the house
-- convention set by `leave_entry` (0033:15 - "Ledger rows are never
-- hard-deleted") and `scenario_expense` (0034:13 - "No delete grant"), but it
-- goes one step further than both: those tables allow UPDATE for corrections,
-- and this one must not, because there is no such thing as correcting what
-- somebody agreed to. A superseding acceptance is a new row.
--
-- Withdrawal of consent, when that is built, is likewise a new row of its own
-- and not a mutation of this one. This migration does not model withdrawal; it
-- models the fact of acceptance.
--
-- WHAT IS DELIBERATELY NOT STORED
-- -------------------------------
-- No IP address and no user-agent string. The obvious instinct for an
-- acceptance record is to capture both, and the brief allowed them only if the
-- repository already stored such values elsewhere. It does not: a search of
-- `database/migrations`, `apps/` and `packages/` finds no `ip_address`, no
-- `user_agent` and no `x-forwarded-for` column or field anywhere in the schema
-- or the application. `audit_event` (0009) records actor, action, resource,
-- correlation id and purpose, and no network identifiers at all.
--
-- Adding them here would make this table the first place in the product to
-- persist network-level personal data about the account holder, introduced as a
-- side effect of a legal-text change and governed by no retention rule. A
-- privacy policy is a poor place to start collecting more personal data than
-- the product collects today. `correlation_id` is stored instead: it is the
-- request identifier the rest of the schema already uses, it ties the
-- acceptance to its audit_event, and it identifies a request rather than a
-- person or a device.
--
-- IDEMPOTENCE
-- -----------
-- Acceptance is recorded from two places - the end of onboarding and the
-- billing flow - and either can be retried, reloaded or opened in two tabs. The
-- unique constraint makes the same principal accepting the same version of the
-- same document exactly one row; callers insert with `on conflict do nothing`
-- and then read the row back. The first acceptance is the one with evidentiary
-- value, so keeping it and discarding the duplicate is also the correct
-- semantics, not merely the convenient one.
--
-- ACCESS PATH
-- -----------
-- Row level security is enabled and forced, the policy is the standard
-- `tenant_id = current_setting('app.tenant_id', true)::uuid`, and every read and
-- write goes through `withTenant()` in packages/db/src/pool.ts - the single
-- database path enforced by scripts/check-tenant-db-path.mjs. `force row level
-- security` matters here specifically because the table owner would otherwise
-- be exempt from its own policy.
--
-- No function is created by this migration, so there is nothing to
-- `revoke all privileges on function ... from public`.
--
-- ADDITIVE
-- --------
-- One new table. No column dropped, no row deleted, no existing value
-- rewritten. Nothing already in the database is read or touched.

create table terms_acceptance (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  -- The natural person who accepted. Not a foreign key, matching the
  -- created_by/updated_by convention used throughout this schema: identity
  -- lives in Supabase auth, and an acceptance must remain readable as evidence
  -- even if the account is later removed from the tenant.
  user_id uuid not null,
  document text not null check (document in ('terms', 'privacy')),
  -- The published version of the document the user was actually shown. Free
  -- text rather than an enum so that publishing a new version is a content
  -- change and never a migration; the constant that produces it lives beside
  -- the document text in packages/i18n/src/legal-documents.ts and is both
  -- rendered on the page and submitted here, so the two cannot diverge.
  version text not null check (length(trim(version)) between 1 and 40),
  accepted_at timestamptz not null default now(),
  -- Which product moment produced the acceptance: 'onboarding' at the end of
  -- setup, 'billing' before a subscription is created. Not a legal field; it
  -- exists so that a later question about a specific acceptance can be traced
  -- back to a specific screen.
  context text not null check (context in ('onboarding', 'billing')),
  -- The request identifier shared with audit_event. Identifies a request, not
  -- a person or a device. See "WHAT IS DELIBERATELY NOT STORED" above.
  correlation_id text,
  created_at timestamptz not null default now(),
  constraint terms_acceptance_once unique (tenant_id, user_id, document, version)
);

-- The only read the product performs: "has this user accepted this document,
-- and at which version". Newest first so a superseding acceptance is found
-- before the one it supersedes.
create index terms_acceptance_by_principal
  on terms_acceptance (tenant_id, user_id, document, accepted_at desc);

alter table terms_acceptance enable row level security;
alter table terms_acceptance force row level security;

create policy terms_acceptance_tenant_isolation on terms_acceptance
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- select, insert and nothing else. An acceptance record is evidence: no UPDATE
-- grant, because there is no correcting what somebody agreed to, and no DELETE
-- grant, because evidence that the application can erase is not evidence. A
-- superseding acceptance is a new row.
grant select, insert on terms_acceptance to caredesk_app;

insert into schema_migrations (version) values ('0043_terms_acceptance');

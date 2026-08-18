-- Audit event (Database Blueprint §4.10, migration order §10 step 9;
-- Constitution §19).
--
-- This is the security and change record, NOT the user-facing case history.
-- `timeline_event` (0007) is what a family member reads; `audit_event` is what
-- a compliance reviewer or incident responder reads. The two are deliberately
-- separate tables with different audiences, different grants and different
-- content rules.
--
-- PRIVACY CONTRACT (Constitution §16 and §19 — read before adding a column):
--   An audit entry records WHAT happened, not the data it happened to. It must
--   never contain secrets, credentials, tokens, full sensitive values (passport
--   or ID numbers, bank details, salary figures), file contents, or AI prompt
--   or completion text. There is deliberately no jsonb/blob payload column and
--   no unbounded free-text column: `change_summary` and `reason` are short,
--   length-capped prose ("Task status changed to completed."), which makes
--   dumping a whole record into the audit trail awkward by design. If you find
--   yourself wanting a wider column, the answer is almost always a narrower
--   `action` value plus a resource reference, not more text.
--
-- APPEND-ONLY:
--   `caredesk_app` is granted select and insert only. An audit trail the
--   application can rewrite is not an audit trail. Corrections are new rows,
--   never updates. This mirrors how `timeline_event` is granted in 0007, but
--   here it is a security property rather than a modelling preference.
--
-- TENANT_ID IS DELIBERATELY NOT A FOREIGN KEY TO `tenant`:
--   Every other tenant-scoped table references `tenant (id)`, so the omission
--   here is a decision, not an oversight. Blueprint §9 requires the model to
--   support a deletion/anonymization workflow while "preserving minimal audit
--   evidence without retaining unnecessary content". A foreign key makes that
--   impossible to satisfy: erasing or anonymising a tenant would either be
--   blocked by the constraint or cascade away the very evidence that proves
--   what was done to that tenant's data and by whom — including the erasure
--   itself. Audit records must outlive the records they describe. Tenant
--   isolation is still enforced: `tenant_id` is `not null` and the RLS policy
--   below scopes every read and write to the current tenant exactly as an FK-
--   backed table would. What is lost is referential cleanup, which for an
--   append-only evidence log is a feature.

create table audit_event (
  id uuid primary key default gen_random_uuid(),
  -- No FK to tenant — see the note above.
  tenant_id uuid not null,
  -- Null only for security events with no authenticated actor (a failed login
  -- attempt, an unauthenticated request). Authenticated actions always set it.
  actor_id uuid,
  -- Constitution §19 "event type": a dotted, stable, non-translated action
  -- name such as 'employment_case.opened' or 'document.downloaded'.
  action text not null,
  resource_type text not null,
  -- `text`, not `uuid`: some audited resources are not rows (for example a
  -- session, a health endpoint, or an external object key).
  resource_id text not null,
  -- When the audited thing happened, per the application clock.
  occurred_at timestamptz not null,
  -- When the row reached the database. Divergence from occurred_at is itself a
  -- signal, so it is recorded separately and always by the server.
  recorded_at timestamptz not null default now(),
  -- Constitution §19 correlation ID: ties an audit entry to the request, its
  -- logs and its timeline events.
  correlation_id text not null,
  -- Constitution §19 source channel.
  source_channel text not null default 'api'
    check (source_channel in ('api', 'web', 'mobile', 'system', 'job', 'import')),
  -- Blueprint §4.10 purpose: why the access/change was made, as a short code
  -- (for example 'case_management', 'support_request'), never prose about a
  -- person.
  purpose text,
  -- Blueprint §4.10 before/after metadata. A SHORT summary of the change, e.g.
  -- "Task status changed to completed." Never before/after values of sensitive
  -- fields — name the field, not its contents.
  change_summary text,
  -- Blueprint §4.10 permission decision: whether the attempt was allowed.
  -- Denials are audit-worthy precisely because they are the interesting ones.
  permission_decision text not null default 'allowed'
    check (permission_decision in ('allowed', 'denied')),
  -- Canonical sensitivity classes (SYNC_MATRIX.md) — the class of the resource
  -- touched, not any value from it.
  sensitivity text not null default 'general'
    check (sensitivity in (
      'general', 'employment_sensitive', 'financial_sensitive',
      'identity_sensitive', 'care_sensitive'
    )),
  -- Blueprint §4.10 reason: e.g. the denial reason, or the justification an
  -- actor gave for a privileged access.
  reason text,
  -- Constitution §19: rule version where relevant, AI involvement where
  -- relevant. `ai_involved` marks an AI-assisted recommendation used in a
  -- decision; the prompt and completion themselves are never stored here.
  rule_version text,
  ai_involved boolean not null default false,
  -- Length caps are the privacy contract made mechanical: a short summary
  -- cannot hold a document, a bank statement or a model prompt.
  constraint audit_event_change_summary_is_a_summary
    check (change_summary is null or length(change_summary) <= 500),
  constraint audit_event_reason_is_short
    check (reason is null or length(reason) <= 500),
  constraint audit_event_purpose_is_a_code
    check (purpose is null or length(purpose) <= 100),
  -- A denial must say why; an allow needs no justification to be meaningful.
  constraint audit_event_denial_has_reason
    check (permission_decision <> 'denied' or reason is not null)
);

-- Blueprint §8: audit is queried newest-first per tenant, and by the resource
-- under investigation.
create index audit_event_by_tenant_time on audit_event (tenant_id, occurred_at desc);
create index audit_event_by_resource on audit_event (resource_type, resource_id);

alter table audit_event enable row level security;
alter table audit_event force row level security;

create policy audit_event_tenant_isolation on audit_event
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Append-only for the application: select and insert, never update or delete.
grant select, insert on audit_event to caredesk_app;

insert into schema_migrations (version) values ('0009_audit_event');

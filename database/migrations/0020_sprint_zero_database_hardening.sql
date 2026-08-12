-- Sprint 0 database hardening. This migration is deliberately additive: it
-- improves the access paths used by current normalized queries and closes
-- same-tenant reference gaps without introducing roadmap entities.

-- Resource investigations are always tenant-scoped under RLS. Prefixing the
-- resource key with tenant_id avoids scanning matching resources belonging to
-- other tenants; occurred_at supports the usual newest-first review.
create index audit_event_by_tenant_resource
  on audit_event (tenant_id, resource_type, resource_id, occurred_at desc);

-- Operational task queues exclude terminal and deliberately deferred work.
-- A partial index is smaller than task_by_due and directly orders the rows the
-- current queue needs.
create index task_open_by_due
  on task (tenant_id, due_at, id)
  where status in ('open', 'in_progress', 'blocked') and due_at is not null;

-- Expiry sweeps concern active documents with a real expiry date. Archived or
-- non-expiring documents should not occupy the compliance scan index.
create index document_active_by_expiry
  on document (tenant_id, expires_at, id)
  where status = 'active' and expires_at is not null;

-- Actor resolution starts from user_id and considers only active memberships
-- whose validity window contains now(). Keep revoked history out of that path.
create index tenant_membership_active_by_user_validity
  on tenant_membership (user_id, valid_from, valid_to)
  where status = 'active';

-- A composite candidate key lets every membership reference carry its tenant
-- boundary into the FK. The primary key still remains the canonical identity.
alter table tenant_membership
  add constraint tenant_membership_tenant_unique unique (tenant_id, id);

alter table family_account
  add constraint family_account_primary_contact_same_tenant
    foreign key (tenant_id, primary_contact_membership_id)
    references tenant_membership (tenant_id, id) not valid;

alter table permission_grant
  add constraint permission_grant_membership_same_tenant
    foreign key (tenant_id, membership_id)
    references tenant_membership (tenant_id, id) not valid;

alter table employment_case
  add constraint employment_case_manager_same_tenant
    foreign key (tenant_id, primary_manager_membership_id)
    references tenant_membership (tenant_id, id) not valid;

-- Validation is explicit so existing bad references fail the deployment. The
-- NOT VALID add phase avoids a long initial table scan while taking the
-- stronger lock; validation uses the lighter validation lock.
alter table family_account validate constraint family_account_primary_contact_same_tenant;
alter table permission_grant validate constraint permission_grant_membership_same_tenant;
alter table employment_case validate constraint employment_case_manager_same_tenant;

insert into schema_migrations (version) values ('0020_sprint_zero_database_hardening');

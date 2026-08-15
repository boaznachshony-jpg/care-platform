-- Worker authentication starts with a global Supabase app_user id and cannot
-- safely accept a tenant id from the browser. These two narrow lookup
-- functions reveal only the tenant needed to establish RLS context. All
-- product reads still happen as caredesk_app under forced RLS.
create or replace function resolve_worker_portal_tenants(p_user_id uuid)
returns table (tenant_id uuid)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select distinct access.tenant_id
  from worker_portal_access access
  where access.user_id = p_user_id and access.status = 'active'
$$;

create or replace function resolve_worker_invitation_tenant(p_token_hash text)
returns table (tenant_id uuid)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select invitation.tenant_id
  from worker_portal_invitation invitation
  where invitation.token_hash = p_token_hash
    and invitation.consumed_at is null
    and invitation.revoked_at is null
    and invitation.expires_at > now()
  limit 1
$$;

revoke all on function resolve_worker_portal_tenants(uuid) from public;
revoke all on function resolve_worker_invitation_tenant(text) from public;
grant execute on function resolve_worker_portal_tenants(uuid) to caredesk_app;
grant execute on function resolve_worker_invitation_tenant(text) to caredesk_app;

insert into schema_migrations (version) values ('0026_wave5_worker_authorization');

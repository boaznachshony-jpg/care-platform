-- Server-side auth subject -> actor resolution for the closed pilot.
--
-- This is deliberately a narrow SECURITY DEFINER function: caredesk_app may
-- resolve only an exact provider subject and receives only internal user and
-- tenant ids. It does not receive email, profile fields, other memberships or
-- any tenant-owned data. The application rejects an ambiguous (multi-tenant)
-- result until an explicit tenant switch flow exists.

create or replace function resolve_caredesk_actor(p_auth_subject text)
returns table (user_id uuid, tenant_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select u.id, m.tenant_id
    from public.app_user u
    join public.tenant_membership m on m.user_id = u.id
    join public.tenant t on t.id = m.tenant_id
   where u.auth_subject = p_auth_subject
     and u.status = 'active'
     and m.status = 'active'
     and m.valid_from <= now()
     and (m.valid_to is null or m.valid_to > now())
     and t.status = 'active'
   order by m.valid_from desc
   limit 2
$$;

revoke all on function resolve_caredesk_actor(text) from public;
grant execute on function resolve_caredesk_actor(text) to caredesk_app;

insert into schema_migrations (version) values ('0010_actor_resolution');

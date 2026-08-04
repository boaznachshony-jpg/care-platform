-- Family collaboration for the closed pilot: one identity per person, scoped
-- to one tenant through tenant_membership. Contacts/authorized representatives
-- remain business contacts and never become users implicitly.

alter table tenant_membership
  add constraint tenant_membership_role_vocabulary
  check (role in ('owner', 'manager', 'viewer', 'family_member')) not valid;

alter table tenant_membership validate constraint tenant_membership_role_vocabulary;

create or replace function list_caredesk_family_members(p_tenant_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  display_name text,
  email text,
  role text,
  identity_status text,
  invited_at timestamptz,
  last_authenticated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select m.id, u.id, u.display_name, u.email, m.role, u.status,
         m.created_at, u.last_authenticated_at
    from public.tenant_membership m
    join public.app_user u on u.id = m.user_id
   where m.tenant_id = p_tenant_id
     and p_tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
     and m.status = 'active'
     and m.valid_from <= now()
     and (m.valid_to is null or m.valid_to > now())
   order by case m.role when 'owner' then 0 when 'manager' then 1 else 2 end,
            m.created_at
$$;

create or replace function create_caredesk_family_member(
  p_tenant_id uuid,
  p_membership_id uuid,
  p_user_id uuid,
  p_auth_subject text,
  p_display_name text,
  p_email text,
  p_role text,
  p_invited_by uuid
)
returns table (
  membership_id uuid,
  user_id uuid,
  display_name text,
  email text,
  role text,
  identity_status text,
  invited_at timestamptz,
  last_authenticated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid;
begin
  if p_tenant_id is distinct from nullif(current_setting('app.tenant_id', true), '')::uuid then
    raise exception 'tenant_context_mismatch';
  end if;
  if p_role not in ('manager', 'viewer') then
    raise exception 'invalid_family_role';
  end if;
  if not exists (
    select 1 from public.tenant_membership
     where tenant_id = p_tenant_id and user_id = p_invited_by
       and role = 'owner' and status = 'active'
       and valid_from <= now() and (valid_to is null or valid_to > now())
  ) then
    raise exception 'owner_membership_required';
  end if;

  select id into v_user_id
    from public.app_user
   where lower(email) = lower(p_email)
   limit 1;

  if v_user_id is not null then
    if not exists (
      select 1 from public.app_user
       where id = v_user_id and auth_subject = p_auth_subject
    ) then
      raise exception 'identity_email_conflict';
    end if;
    if exists (
      select 1 from public.tenant_membership
       where user_id = v_user_id and status = 'active'
    ) then
      raise exception 'identity_already_has_membership';
    end if;
    update public.app_user
       set display_name = p_display_name, status = 'invited', updated_at = now(),
           version = version + 1
     where id = v_user_id;
  else
    v_user_id := p_user_id;
    insert into public.app_user
      (id, auth_subject, display_name, email, status)
    values
      (v_user_id, p_auth_subject, p_display_name, lower(p_email), 'invited');
  end if;

  insert into public.tenant_membership
    (id, tenant_id, user_id, role, status, invited_by)
  values
    (p_membership_id, p_tenant_id, v_user_id, p_role, 'active', p_invited_by);

  return query
    select f.membership_id, f.user_id, f.display_name, f.email, f.role,
           f.identity_status, f.invited_at, f.last_authenticated_at
      from public.list_caredesk_family_members(p_tenant_id) f
     where f.membership_id = p_membership_id;
end
$$;

create or replace function update_caredesk_family_member_role(
  p_tenant_id uuid,
  p_membership_id uuid,
  p_role text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_tenant_id is distinct from nullif(current_setting('app.tenant_id', true), '')::uuid then
    raise exception 'tenant_context_mismatch';
  end if;
  if p_role not in ('manager', 'viewer') then
    raise exception 'invalid_family_role';
  end if;
  update public.tenant_membership
     set role = p_role, updated_at = now(), version = version + 1
   where tenant_id = p_tenant_id and id = p_membership_id
     and role <> 'owner' and status = 'active';
  return found;
end
$$;

create or replace function revoke_caredesk_family_member(
  p_tenant_id uuid,
  p_membership_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_tenant_id is distinct from nullif(current_setting('app.tenant_id', true), '')::uuid then
    raise exception 'tenant_context_mismatch';
  end if;
  update public.tenant_membership
     set status = 'revoked', valid_to = now(), updated_at = now(), version = version + 1
   where tenant_id = p_tenant_id and id = p_membership_id
     and role <> 'owner' and status = 'active';
  return found;
end
$$;

-- An invited identity becomes active only after the identity provider has
-- verified the one-time link and the user reaches the API with a valid token.
create or replace function resolve_caredesk_actor(p_auth_subject text)
returns table (user_id uuid, tenant_id uuid)
language sql
volatile
security definer
set search_path = pg_catalog, public
as $$
  with candidates as materialized (
    select u.id as user_id, m.tenant_id
      from public.app_user u
      join public.tenant_membership m on m.user_id = u.id
      join public.tenant t on t.id = m.tenant_id
     where u.auth_subject = p_auth_subject
       and u.status in ('active', 'invited')
       and m.status = 'active'
       and m.valid_from <= now()
       and (m.valid_to is null or m.valid_to > now())
       and t.status = 'active'
     order by m.valid_from desc
     limit 2
  ), unique_candidate as (
    select c.user_id, c.tenant_id
      from candidates c
     where (select count(*) from candidates) = 1
     limit 1
  ), activated as (
    update public.app_user u
       set status = 'active', last_authenticated_at = now(), updated_at = now(),
           version = u.version + 1
      from unique_candidate c
     where u.id = c.user_id
    returning u.id
  )
  select c.user_id, c.tenant_id
    from unique_candidate c
    join activated a on a.id = c.user_id
$$;

revoke all on function list_caredesk_family_members(uuid) from public;
revoke all on function create_caredesk_family_member(uuid, uuid, uuid, text, text, text, text, uuid) from public;
revoke all on function update_caredesk_family_member_role(uuid, uuid, text) from public;
revoke all on function revoke_caredesk_family_member(uuid, uuid) from public;
grant execute on function list_caredesk_family_members(uuid) to caredesk_app;
grant execute on function create_caredesk_family_member(uuid, uuid, uuid, text, text, text, text, uuid) to caredesk_app;
grant execute on function update_caredesk_family_member_role(uuid, uuid, text) to caredesk_app;
grant execute on function revoke_caredesk_family_member(uuid, uuid) to caredesk_app;

insert into schema_migrations (version) values ('0013_family_access');

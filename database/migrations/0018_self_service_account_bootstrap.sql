-- Self-service owner account bootstrap for direct Supabase email/password sign-up.
--
-- Supabase Auth owns credentials. This trigger creates only CareDesk's internal
-- tenant, profile and owner membership, so the first authenticated /workspace
-- request can resolve an actor immediately. Admin-created family invitations
-- are deliberately skipped: migration 0013 attaches those identities to the
-- inviting family's existing tenant.

create or replace function public.bootstrap_caredesk_owner_from_auth()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := gen_random_uuid();
  v_tenant_id uuid := gen_random_uuid();
  v_membership_id uuid := gen_random_uuid();
  v_display_name text;
begin
  if new.invited_at is not null or new.email is null or btrim(new.email) = '' then
    return new;
  end if;

  -- Auth may retry an insert during recovery. Never create a second tenant for
  -- an identity or email that CareDesk has already linked.
  if exists (
    select 1
      from public.app_user
     where auth_subject = new.id::text or lower(email) = lower(new.email)
  ) then
    return new;
  end if;

  v_display_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(new.email, '@', 1), ''),
    'CareDesk'
  );

  insert into public.tenant
    (id, status, timezone, default_locale, data_region)
  values
    (v_tenant_id, 'active', 'Asia/Jerusalem', 'he', 'eu-central');

  insert into public.app_user
    (id, auth_subject, display_name, email, preferred_locale, status)
  values
    (v_user_id, new.id::text, v_display_name, lower(new.email), 'he', 'active');

  insert into public.family_account
    (tenant_id, display_name, lifecycle_status)
  values
    (v_tenant_id, v_display_name, 'active');

  insert into public.tenant_membership
    (id, tenant_id, user_id, role, status, mfa_required)
  values
    (v_membership_id, v_tenant_id, v_user_id, 'owner', 'active', false);

  update public.family_account
     set primary_contact_membership_id = v_membership_id
   where tenant_id = v_tenant_id;

  return new;
end
$$;

revoke all on function public.bootstrap_caredesk_owner_from_auth() from public, anon, authenticated;

-- Local PostgreSQL does not include Supabase's auth schema. Keep local
-- migrations runnable while installing the trigger on the hosted database.
do $$
begin
  if to_regclass('auth.users') is not null then
    execute 'drop trigger if exists caredesk_owner_bootstrap on auth.users';
    execute 'create trigger caredesk_owner_bootstrap after insert on auth.users for each row execute function public.bootstrap_caredesk_owner_from_auth()';
  end if;
end
$$;

insert into schema_migrations (version)
values ('0018_self_service_account_bootstrap');

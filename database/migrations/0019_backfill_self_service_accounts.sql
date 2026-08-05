-- Repair direct Supabase sign-ups that were created before the automatic
-- CareDesk owner bootstrap trigger was installed. Invited family identities
-- remain excluded because migration 0013 attaches them to the inviter's
-- existing tenant.

create or replace function public.ensure_caredesk_owner_account(
  p_auth_subject uuid,
  p_email text,
  p_raw_user_meta_data jsonb,
  p_invited_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid;
  v_tenant_id uuid := gen_random_uuid();
  v_membership_id uuid := gen_random_uuid();
  v_display_name text;
begin
  if p_invited_at is not null or p_email is null or btrim(p_email) = '' then
    return;
  end if;

  -- A sign-up request and this one-time backfill may overlap. Serialize work
  -- per Supabase identity so they can never create two owner accounts.
  perform pg_advisory_xact_lock(hashtextextended(p_auth_subject::text, 0));

  if exists (
    select 1
      from public.app_user
     where lower(email) = lower(p_email)
       and auth_subject <> p_auth_subject::text
  ) then
    raise exception 'caredesk_identity_email_conflict';
  end if;

  select id
    into v_user_id
    from public.app_user
   where auth_subject = p_auth_subject::text
   limit 1;

  if v_user_id is not null and exists (
    select 1
      from public.tenant_membership
     where user_id = v_user_id
       and status = 'active'
       and valid_from <= now()
       and (valid_to is null or valid_to > now())
  ) then
    return;
  end if;

  v_display_name := coalesce(
    nullif(btrim(coalesce(p_raw_user_meta_data, '{}'::jsonb) ->> 'display_name'), ''),
    nullif(split_part(p_email, '@', 1), ''),
    'CareDesk'
  );

  if v_user_id is null then
    v_user_id := gen_random_uuid();
    insert into public.app_user
      (id, auth_subject, display_name, email, preferred_locale, status)
    values
      (v_user_id, p_auth_subject::text, v_display_name, lower(p_email), 'he', 'active');
  else
    update public.app_user
       set display_name = v_display_name,
           email = lower(p_email),
           preferred_locale = 'he',
           status = 'active',
           updated_at = now(),
           version = version + 1
     where id = v_user_id;
  end if;

  insert into public.tenant
    (id, status, timezone, default_locale, data_region)
  values
    (v_tenant_id, 'active', 'Asia/Jerusalem', 'he', 'eu-central');

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
end
$$;

revoke all on function public.ensure_caredesk_owner_account(uuid, text, jsonb, timestamptz)
  from public, anon, authenticated;

-- Keep the trigger entry point small and reuse the same idempotent operation
-- for both future inserts and the one-time repair below.
create or replace function public.bootstrap_caredesk_owner_from_auth()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.ensure_caredesk_owner_account(
    new.id,
    new.email,
    new.raw_user_meta_data,
    new.invited_at
  );
  return new;
end
$$;

revoke all on function public.bootstrap_caredesk_owner_from_auth()
  from public, anon, authenticated;

do $$
declare
  v_auth_user record;
begin
  if to_regclass('auth.users') is not null then
    execute 'drop trigger if exists caredesk_owner_bootstrap on auth.users';
    execute 'create trigger caredesk_owner_bootstrap after insert on auth.users for each row execute function public.bootstrap_caredesk_owner_from_auth()';

    for v_auth_user in execute
      'select id, email, raw_user_meta_data, invited_at
         from auth.users
        where invited_at is null
          and email is not null
          and btrim(email) <> '''''
    loop
      perform public.ensure_caredesk_owner_account(
        v_auth_user.id,
        v_auth_user.email,
        v_auth_user.raw_user_meta_data,
        v_auth_user.invited_at
      );
    end loop;
  end if;
end
$$;

insert into schema_migrations (version)
values ('0019_backfill_self_service_accounts');

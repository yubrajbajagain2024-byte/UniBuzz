-- =============================================================================
-- UniBuzz - who is an admin for the business portal's staff actions
-- Follows 20261101000000_business_portal.sql (migration 39: is_admin(), require_admin()).
--  * Where CampConnect Admin's staff list exists (public.staff; production has it from the
--    migrations in supabase/applied-outside-repo), an admin is a staff owner or admin who is not
--    suspended and whose session passed two-factor sign-in with a factor that is still verified:
--    the rule every staff_* function already follows (staff_require('admin')). The admin role on
--    profiles no longer counts there on its own.
--  * Without the staff list (a database built from this repo alone), profiles.role = 'admin'
--    still decides, as in migration 39.
--  * admin_standing() tells the caller where they stand: 'admin', 'mfa_required' (a staff admin
--    whose session has not passed two-factor sign-in) or null. The portal sends 'mfa_required' to
--    its two-factor page; require_admin() says the same with hint MFA_REQUIRED.
--  * The staff table is read with dynamic SQL and is_suspended() is called only where it exists,
--    so this file runs on either schema. profiles.role is left as it is.
-- Rollback: supabase/rollbacks/20261106000000_admin_authority.down.sql. Safe to run more than once.
-- =============================================================================

create or replace function public.admin_standing()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_role text;
begin
  if v_me is null then
    return null;
  end if;
  if to_regclass('public.staff') is null then
    return case when public.role_of(v_me) = 'admin' then 'admin' end;
  end if;
  execute 'select s.role from public.staff s where s.user_id = $1' into v_role using v_me;
  if v_role is null or v_role not in ('owner', 'admin') then
    return null;
  end if;
  -- Nested so plpgsql resolves is_suspended only where migration 15 (outside this repo) added it.
  if to_regprocedure('public.is_suspended(uuid)') is not null then
    if public.is_suspended(v_me) then
      return null;
    end if;
  end if;
  -- CampConnect Admin's staff_mfa_verified(): a factor deleted in the dashboard ends access at once.
  if coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (select 1 from auth.mfa_factors f where f.user_id = v_me and f.status = 'verified') then
    return 'admin';
  end if;
  return 'mfa_required';
end;
$$;

-- The caller's own standing only: the portal reads it to route an admin.
revoke all on function public.admin_standing() from public, anon, authenticated;
grant execute on function public.admin_standing() to authenticated;

-- Row-level security calls this as the caller, so the API roles keep the execute right migration 39 left them.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.admin_standing() is not distinct from 'admin';
$$;

-- Every administrative function starts here.
create or replace function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_standing text := public.admin_standing();
begin
  if v_standing = 'mfa_required' then
    raise exception 'Confirm it''s you with your authenticator app first' using errcode = '42501', hint = 'MFA_REQUIRED';
  end if;
  if v_standing is distinct from 'admin' then
    raise exception 'Only CampConnect admins can do this' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.require_admin() from public, anon, authenticated;

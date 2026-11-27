-- Rollback of migration 78 (20261203000000_staff_standing.sql). Run in one transaction with
--   delete from public._migrations where name = '20261203000000_staff_standing.sql';
-- then notify pgrst, 'reload schema'.
--
-- It puts staff_role_of() (72), admin_standing() (67) and CampConnect Admin's staff_require() back word for word and
-- drops staff_sanctioned(). Nothing is refused.

create or replace function public.staff_role_of(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if p_user is null then
    return null;
  end if;
  if to_regclass('public.staff') is not null then
    execute 'select s.role from public.staff s where s.user_id = $1' into v_role using p_user;
    if v_role is not null and to_regprocedure('public.is_suspended(uuid)') is not null then
      if public.is_suspended(p_user) then
        return null;
      end if;
    end if;
    return v_role;
  end if;
  select m.role into v_role from public.staff_members m where m.user_id = p_user;
  return v_role;
end;
$$;

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

do $do$
begin
  if to_regclass('public.staff') is null then
    return;
  end if;
  execute $ddl$
create or replace function public.staff_require(p_min_role text, p_require_mfa boolean default true)
returns public.staff
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_me uuid := auth.uid();
  v_row public.staff;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  select * into v_row from public.staff s where s.user_id = v_me;
  if v_row.user_id is null then
    raise exception 'Not allowed';
  end if;
  if public.is_suspended(v_me) then
    raise exception 'Your account is suspended' using errcode = 'P0001', hint = 'ACCOUNT_SUSPENDED';
  end if;
  if public.staff_role_rank(v_row.role) < public.staff_role_rank(p_min_role) then
    raise exception 'Not allowed';
  end if;
  if p_require_mfa and not public.staff_mfa_verified() then
    raise exception 'Two-factor authentication required';
  end if;
  return v_row;
end;
$fn$
  $ddl$;
end
$do$;

drop function if exists public.staff_sanctioned(uuid);

notify pgrst, 'reload schema';

-- Migration 78: one standing for the staff across both sanction systems (Phase 4 of the UniBuzz Master Admin Portal
-- roadmap, docs/status.md: one moderation model). Follows 77 (20261202000000_university_console.sql) in file order;
-- needs 41 (Trust & Safety's user_sanctions), 67 (admin_standing) and 72 (staff_role_of). Rollback:
-- supabase/rollbacks/20261203000000_staff_standing.down.sql.
--
-- Staff powers are decided by staff_role_of() (72: the portal's permissions, Trust & Safety's role, campus scopes),
-- admin_standing() (67: the business console and the account admin role) and CampConnect Admin's staff_require(). They
-- read CampConnect Admin's suspensions (is_suspended(), account_restrictions); from here they also read Trust & Safety's:
--
-- 1. staff_sanctioned(user) (internal): an active Trust & Safety suspension or ban covering the whole account (scope
--    'all'; in effect, not lifted, not expired), the same test Trust & Safety's own account status uses. A Buzz-only or
--    requests-only sanction, a mute or a warning is not one.
-- 2. staff_role_of() answers nothing for such an account (so Trust & Safety's role, the portal's permissions and a
--    campus admin's campuses go with it); admin_standing() answers nothing; staff_require() refuses it as suspended.
--
-- Sign-in is left as Trust & Safety has it (it ends the account's sessions, and the account may sign in again to read
-- its status and appeal). Lifting or expiry gives the powers back at once. Safe to run more than once.

create or replace function public.staff_sanctioned(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null and exists (
    select 1 from public.user_sanctions s
    where s.user_id = p_user and s.kind in ('suspension', 'ban') and coalesce(s.scope, 'all') = 'all'
      and s.lifted_at is null and s.effective_at <= now() and (s.expires_at is null or s.expires_at > now())
  );
$$;
revoke all on function public.staff_sanctioned(uuid) from public, anon, authenticated;

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
  -- Migration 78: an account-wide Trust & Safety suspension or ban ends staff powers too.
  if public.staff_sanctioned(p_user) then
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
  -- Migration 78: an account-wide Trust & Safety suspension or ban ends admin standing too.
  if public.staff_sanctioned(v_me) then
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
  -- Migration 78: CampConnect Admin's own suspension, or an account-wide Trust & Safety suspension or ban.
  if public.is_suspended(v_me) or public.staff_sanctioned(v_me) then
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

notify pgrst, 'reload schema';

-- Rollback of 20261106000000_admin_authority.sql: is_admin() and require_admin() exactly as migration 39
-- (20261101000000_business_portal.sql) defined them, and admin_standing() gone. Afterwards the admin role on
-- profiles decides again, without the staff list, suspensions or two-factor sign-in. Safe to run more than once.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and public.role_of(auth.uid()) = 'admin';
$$;

create or replace function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only CampConnect admins can do this' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.require_admin() from public, anon, authenticated;

drop function if exists public.admin_standing();

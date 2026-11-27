-- Rollback of migration 72 (20261127000000_staff_scopes.sql): campus scopes for the staff. Run in one transaction with
--   delete from public._migrations where name = '20261127000000_staff_scopes.sql';
-- then notify pgrst, 'reload schema'.
--
-- It refuses while anyone holds or is invited to the campus_admin role, or a campus is assigned: those would be left
-- with a role the restored resolvers turn into 'admin' everywhere (migration 41's ts_role_of). Remove them first, on
-- purpose. It restores migration 41's ts_role_of() and ts_staff_ids() word for word and the role checks as they were.

do $$
declare
  v_n int := 0;
  v_m int;
begin
  if to_regclass('public.staff') is not null then
    execute 'select count(*) from public.staff where role = ''campus_admin''' into v_m;
    v_n := v_n + v_m;
  end if;
  if to_regclass('public.staff_invites') is not null then
    execute 'select count(*) from public.staff_invites where role = ''campus_admin''' into v_m;
    v_n := v_n + v_m;
  end if;
  select v_n + count(*) into v_n from public.staff_members where role = 'campus_admin';
  if to_regclass('public.staff_campuses') is not null then
    execute 'select count(*) from public.staff_campuses' into v_m;
    v_n := v_n + v_m;
  end if;
  if v_n > 0 then
    raise exception 'Rollback refused: % campus admin(s), invitation(s) or campus assignment(s) exist; remove them first', v_n;
  end if;
end;
$$;

drop function if exists public.admin_my_permissions();
drop function if exists public.staff_require_can(text, uuid);
drop function if exists public.staff_can(text, uuid);
drop function if exists public.staff_role_permissions(text);
drop table if exists public.staff_campuses;

-- Migration 41's resolvers, as they were.
create or replace function public.ts_role_of(p_user uuid)
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
    execute 'select case s.role when ''moderator'' then ''moderator'' else ''admin'' end from public.staff s where s.user_id = $1'
      into v_role using p_user;
    if v_role is not null and to_regprocedure('public.is_suspended(uuid)') is not null then
      if public.is_suspended(p_user) then
        return null;
      end if;
    end if;
    return v_role;
  end if;
  select s.role into v_role from public.staff_members s where s.user_id = p_user;
  return v_role;
end;
$$;

create or replace function public.ts_staff_ids(p_admins_only boolean)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if to_regclass('public.staff') is not null then
    return query execute 'select s.user_id from public.staff s where not $1 or s.role in (''owner'', ''admin'')' using coalesce(p_admins_only, false);
    return;
  end if;
  return query select m.user_id from public.staff_members m where not coalesce(p_admins_only, false) or m.role = 'admin';
end;
$$;

drop function if exists public.staff_role_of(uuid);

do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass::text as tbl, c.conname
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid in (select to_regclass(x) from unnest(array['public.staff', 'public.staff_invites', 'public.staff_members']) x where to_regclass(x) is not null)
      and pg_get_constraintdef(c.oid) ~ '\mrole\M'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
  if to_regclass('public.staff') is not null then
    execute $q$alter table public.staff add constraint staff_role_check check (role in ('owner', 'admin', 'moderator'))$q$;
  end if;
  if to_regclass('public.staff_invites') is not null then
    execute $q$alter table public.staff_invites add constraint staff_invites_role_check check (role in ('owner', 'admin', 'moderator'))$q$;
  end if;
  alter table public.staff_members add constraint staff_members_role_check check (role in ('moderator', 'admin'));
end;
$$;

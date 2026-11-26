-- Migration 72: campus scopes for the staff, default deny (Phase 2a of the UniBuzz Master Admin Portal roadmap,
-- docs/status.md; the owner's approval of 2026-11-25: roles Owner, Admin, Campus Admin and Moderator, campus isolation
-- decided in SQL, default-deny permissions). Follows 71 (20261126000000_audit_feed.sql). Rollback:
-- supabase/rollbacks/20261127000000_staff_scopes.down.sql.
--
-- 1. The role campus_admin is allowed on the staff list (CampConnect Admin's public.staff and staff_invites, where they
--    exist, and migration 41's staff_members). Nothing can grant it yet: admin_staff_add, admin_staff_set_role and the
--    invitations accept owner, admin and moderator only. Appointing campus admins comes with the screens for it, after
--    the functions they would use are scoped (Phase 2b to 2d).
-- 2. staff_campuses (closed to the API): the universities a campus admin acts for. Its people are auth.users, not
--    profiles, on purpose: PostgREST reads a table whose primary key is two foreign keys as a link between their
--    tables, and a profiles-to-universities link here would make every existing embed of a profile's university
--    ambiguous (PGRST201), breaking the website and the app. auth.users is not exposed, so no link appears; deleting an
--    account still takes its rows (tests/staff-scopes.test.mjs checks no table links profiles and universities so).
-- 3. Every role resolver refuses a role it does not know. ts_role_of() answered 'admin' for any staff role but
--    'moderator', so a campus admin would have had every Trust & Safety, events, universities and audit power across
--    the platform; it now maps owner and admin to 'admin', moderator to 'moderator', and anything else to nothing.
--    ts_staff_ids() (who gets staff notices) leaves out roles it does not know. staff_role_rank() (CampConnect Admin's
--    staff_require) and admin_standing() (migration 67) already refuse them.
-- 4. The permission table moves into SQL: staff_role_permissions(role) (the same names as the portal's
--    lib/permissions.ts; a campus admin's set is empty until a scoped area adds its permissions in its own migration),
--    staff_can(permission, university) (platform roles anywhere; a campus admin only for a university of theirs, never
--    platform-wide), staff_require_can() for scoped functions (not found, or the second factor first), both internal like
--    every staff_* helper, and admin_my_permissions() for the portal's navigation (the caller's own role, campuses and
--    permissions; next to admin_me()).
--
-- Safe to run more than once. Works with and without CampConnect Admin's schema: public.staff is reached with dynamic
-- SQL, is_suspended() only where it exists.

-- -----------------------------------------------------------------------------
-- 1. The role
-- -----------------------------------------------------------------------------
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
    execute $q$alter table public.staff add constraint staff_role_check check (role in ('owner', 'admin', 'campus_admin', 'moderator'))$q$;
  end if;
  if to_regclass('public.staff_invites') is not null then
    execute $q$alter table public.staff_invites add constraint staff_invites_role_check check (role in ('owner', 'admin', 'campus_admin', 'moderator'))$q$;
  end if;
  alter table public.staff_members add constraint staff_members_role_check check (role in ('admin', 'campus_admin', 'moderator'));
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Campuses
-- -----------------------------------------------------------------------------
create table if not exists public.staff_campuses (
  user_id uuid not null,
  university_id uuid not null,
  granted_by uuid,
  created_at timestamptz not null default now(),
  primary key (user_id, university_id),
  constraint staff_campuses_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint staff_campuses_university_id_fkey foreign key (university_id) references public.universities (id) on delete cascade,
  constraint staff_campuses_granted_by_fkey foreign key (granted_by) references auth.users (id) on delete set null
);
create index if not exists staff_campuses_university_idx on public.staff_campuses (university_id);
alter table public.staff_campuses enable row level security;
revoke all on table public.staff_campuses from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Roles as the staff list has them, and the resolvers made default-deny
-- -----------------------------------------------------------------------------
-- The staff role of p_user as stored (owner, admin, campus_admin, moderator), or null: not staff, or (on CampConnect
-- Admin's schema) suspended. migration 41's staff_members has no suspension of its own, as ts_role_of() had none there.
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
revoke all on function public.staff_role_of(uuid) from public, anon, authenticated;

-- Trust & Safety's two roles (migration 41): owners and admins are 'admin', moderators 'moderator'. Any other role,
-- campus_admin included, gets nothing here: a scoped function asks staff_require_can() instead.
create or replace function public.ts_role_of(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return case public.staff_role_of(p_user) when 'owner' then 'admin' when 'admin' then 'admin' when 'moderator' then 'moderator' end;
end;
$$;

-- Everyone on the staff list who gets staff notices (admins only, or the platform's staff); never a role it does not
-- know, so a campus admin is not told about other campuses' queues.
create or replace function public.ts_staff_ids(p_admins_only boolean)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if to_regclass('public.staff') is not null then
    return query execute 'select s.user_id from public.staff s where s.role in (''owner'', ''admin'', ''moderator'') and (not $1 or s.role in (''owner'', ''admin''))'
      using coalesce(p_admins_only, false);
    return;
  end if;
  return query select m.user_id from public.staff_members m
    where m.role in ('admin', 'moderator') and (not coalesce(p_admins_only, false) or m.role = 'admin');
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Permissions
-- -----------------------------------------------------------------------------
-- What each role may do: the portal's lib/permissions.ts, in SQL. Default deny: a role not named here has nothing, and
-- campus_admin has nothing until a scoped area (Phase 2b onwards) adds its permissions here in its own migration.
create or replace function public.staff_role_permissions(p_role text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case p_role
    when 'moderator' then array['dashboard.view', 'users.view', 'moderation.view', 'content.view', 'operations.view', 'support.view',
                                'staff.view', 'audit.view', 'security.self']
    when 'admin' then array['dashboard.view', 'users.view', 'moderation.view', 'content.view', 'operations.view', 'support.view',
                            'staff.view', 'audit.view', 'security.self', 'universities.manage', 'business.manage', 'analytics.view',
                            'audit.context', 'settings.manage']
    when 'owner' then array['dashboard.view', 'users.view', 'moderation.view', 'content.view', 'operations.view', 'support.view',
                            'staff.view', 'audit.view', 'security.self', 'universities.manage', 'business.manage', 'analytics.view',
                            'audit.context', 'settings.manage']
    when 'campus_admin' then array[]::text[]
    else array[]::text[]
  end
$$;
revoke all on function public.staff_role_permissions(text) from public, anon, authenticated;

-- Whether the caller may do p_permission, for p_university when it concerns one. Owners, admins and moderators act
-- platform-wide; a campus admin only for a university of theirs, so never with p_university null. Suspended staff and
-- everyone else: false. The second factor is the caller's to pass separately (staff_require_can checks both).
create or replace function public.staff_can(p_permission text, p_university uuid default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_role text := public.staff_role_of(v_me);
begin
  if v_role is null or p_permission is null or not (p_permission = any (public.staff_role_permissions(v_role))) then
    return false;
  end if;
  if v_role in ('owner', 'admin', 'moderator') then
    return true;
  end if;
  return p_university is not null
    and exists (select 1 from public.staff_campuses c where c.user_id = v_me and c.university_id = p_university);
end;
$$;
-- Internal, like every staff_* helper (CampConnect Admin's rule, kept by tests/permissions-audit.test.mjs): scoped functions
-- call it from inside the database; the portal reads admin_my_permissions().
revoke all on function public.staff_can(text, uuid) from public, anon, authenticated;

-- For scoped staff functions: the caller's role when they may do p_permission (for p_university), in a session that
-- passed the second factor; otherwise 'not found' (staff functions never confirm what exists) or the second factor
-- first, in migration 41's words.
create or replace function public.staff_require_can(p_permission text, p_university uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.staff_can(p_permission, p_university) then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  if not public.ts_mfa_ok() then
    perform public.ts_fail('mfa_required', 'Confirm it''s you with your authenticator app to use the staff console.');
  end if;
  return public.staff_role_of(auth.uid());
end;
$$;
revoke all on function public.staff_require_can(text, uuid) from public, anon, authenticated;

-- The caller's own place on the staff, for the portal's navigation: role, whether it is platform-wide, the campuses of
-- a campus admin, the permissions, and whether this session passed the second factor. Null for anyone not on the staff
-- (or suspended). It tells the caller about themselves only.
create or replace function public.admin_my_permissions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_role text := public.staff_role_of(v_me);
begin
  if v_role is null then
    return null;
  end if;
  return jsonb_build_object(
    'role', v_role,
    'platform', v_role in ('owner', 'admin', 'moderator'),
    'universities', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
                              from public.staff_campuses c join public.universities u on u.id = c.university_id
                              where c.user_id = v_me), '[]'::jsonb),
    'permissions', to_jsonb(public.staff_role_permissions(v_role)),
    'mfaVerified', public.ts_mfa_ok());
end;
$$;
revoke all on function public.admin_my_permissions() from public, anon;
grant execute on function public.admin_my_permissions() to authenticated;

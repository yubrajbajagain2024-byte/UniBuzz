-- Rollback of migration 76 (20261201000000_campus_appointments.sql): appointing campus admins. Run in one transaction with
--   delete from public._migrations where name = '20261201000000_campus_appointments.sql';
-- then notify pgrst, 'reload schema'.
--
-- It refuses while an invitation to the role is pending (dropping staff_invites.university_ids would leave it without
-- its campuses): withdraw them first, on purpose. Campus admins already on the staff stay, with their campuses (72 to
-- 75 serve them); they only lose the campus dashboard's permission. It puts 75's permission table back, migration 18's
-- staff_invite_for_caller() and staff_claim_invite() word for word, and drops the appointing functions, the trigger
-- that clears a former campus admin's campuses, and the column.

do $$
declare
  v_n int := 0;
begin
  if to_regclass('public.staff_invites') is not null then
    execute 'select count(*) from public.staff_invites where role = ''campus_admin''' into v_n;
  end if;
  if v_n > 0 then
    raise exception 'Rollback refused: % pending campus admin invitation(s); withdraw them first', v_n;
  end if;
end;
$$;

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
    when 'campus_admin' then array['moderation.view', 'users.view', 'content.view', 'security.self']
    else array[]::text[]
  end
$$;
revoke all on function public.staff_role_permissions(text) from public, anon, authenticated;

drop trigger if exists staff_campuses_follow_role on public.staff_members;

do $do$
begin
  if to_regclass('public.staff_audit_log') is null or to_regclass('public.staff') is null then
    return;
  end if;
  execute 'drop function if exists public.admin_staff_campuses()';
  execute 'drop function if exists public.admin_campus_admin_set_campuses(uuid, uuid[])';
  execute 'drop function if exists public.admin_campus_admin_add(text, uuid[])';
  execute 'drop function if exists public.staff_valid_campuses(uuid[])';
  execute 'drop trigger if exists staff_campuses_follow_role on public.staff';
  execute $ddl$
create or replace function public.staff_invite_for_caller(p_email text)
returns public.staff_invites
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_caller public.staff;
  v_inv public.staff_invites;
begin
  v_caller := public.staff_require('admin');
  select * into v_inv from public.staff_invites i where i.email = lower(btrim(coalesce(p_email, '')));
  if v_inv.email is null then
    raise exception 'No invitation for that address';
  end if;
  if public.staff_grant_rank(v_caller.role) < public.staff_role_rank(v_inv.role) then
    raise exception 'Not allowed';
  end if;
  return v_inv;
end;
$fn$
  $ddl$;
  execute $ddl$
create or replace function public.staff_claim_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_email text := lower(new.email::text);
  v_inv public.staff_invites;
  v_inviter_role text;
  v_removed text[];
begin
  if new.email_confirmed_at is null or v_email is null then
    return new;
  end if;
  select * into v_inv from public.staff_invites i where i.email = v_email;
  if v_inv.email is null then
    return new;
  end if;
  if not exists (select 1 from public.profiles p where p.id = new.id) then
    return new; -- profile not created yet; the invite stays and can be applied from the Staff page
  end if;
  -- An invitation sent by email belongs to the account that email created. Any other
  -- account with this address (a sign-up made around it) is held, never promoted.
  if v_inv.auth_user_id is not null and v_inv.auth_user_id <> new.id then
    insert into public.staff_audit_log (actor_id, actor_email, action, target_type, target_id, details)
    values (null, null, 'invite.held', 'user', new.id::text,
      jsonb_build_object('email', v_email, 'role', v_inv.role, 'reason', 'not the account the invitation email created'));
    return new;
  end if;
  -- Expired: nothing is granted; the row stays so an admin sees it and can re-send it.
  if v_inv.invited_by is not null and v_inv.expires_at < now() then
    insert into public.staff_audit_log (actor_id, actor_email, action, target_type, target_id, details)
    values (null, null, 'invite.expired', 'user', new.id::text,
      jsonb_build_object('email', v_email, 'role', v_inv.role, 'expired_at', v_inv.expires_at));
    return new;
  end if;
  -- The account predates the invite: whoever registered it may not be the person
  -- we meant (Supabase keeps the first password when a sign-up is repeated).
  -- Not for an email change: that needs the account's session AND a click in
  -- the new mailbox, so the same person holds both. Not for the account the
  -- invitation email itself created (bound above).
  if coalesce(tg_argv[0], '') <> 'email_change' and v_inv.auth_user_id is distinct from new.id and new.created_at < v_inv.created_at then
    insert into public.staff_audit_log (actor_id, actor_email, action, target_type, target_id, details)
    values (null, null, 'invite.held', 'user', new.id::text,
      jsonb_build_object('email', v_email, 'role', v_inv.role, 'reason', 'account predates invite'));
    return new;
  end if;
  if v_inv.invited_by is not null then
    select s.role into v_inviter_role from public.staff s where s.user_id = v_inv.invited_by;
    if v_inviter_role is null or public.staff_grant_rank(v_inviter_role) < public.staff_role_rank(v_inv.role) then
      delete from public.staff_invites where email = v_email;
      insert into public.staff_audit_log (actor_id, actor_email, action, target_type, target_id, details)
      values (null, null, 'invite.revoke', 'email', v_email,
        jsonb_build_object('role', v_inv.role, 'reason', 'inviter no longer able to grant this role', 'invited_by', v_inv.invited_by));
      return new;
    end if;
  end if;
  insert into public.staff (user_id, role, granted_by)
  values (new.id, v_inv.role, v_inv.invited_by)
  on conflict (user_id) do update set role = excluded.role, granted_by = excluded.granted_by;
  delete from public.staff_invites where email = v_email;
  insert into public.staff_audit_log (actor_id, actor_email, action, target_type, target_id, details)
  values (null, null, 'invite.accepted', 'user', new.id::text,
    jsonb_build_object('email', v_email, 'role', v_inv.role, 'invited_by', v_inv.invited_by,
      'via', case when v_inv.auth_user_id is not null then 'email link' else 'sign-up' end));
  -- The first owner has arrived: forget other bootstrap attempts (mistyped addresses).
  if v_inv.invited_by is null and v_inv.role = 'owner' then
    with d as (delete from public.staff_invites i where i.role = 'owner' and i.invited_by is null returning i.email)
    select array_agg(d.email) into v_removed from d;
    if v_removed is not null then
      insert into public.staff_audit_log (actor_id, actor_email, action, target_type, target_id, details)
      values (null, null, 'invite.revoke', 'email', array_to_string(v_removed, ','),
        jsonb_build_object('role', 'owner', 'reason', 'bootstrap superseded'));
    end if;
  end if;
  return new;
end;
$fn$
  $ddl$;
  execute 'alter table public.staff_invites drop column if exists university_ids';
end
$do$;

drop function if exists public.staff_campuses_follow_role();

notify pgrst, 'reload schema';

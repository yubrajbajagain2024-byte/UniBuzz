-- Migration 76: appointing campus admins (Phase 2e of the UniBuzz Master Admin Portal roadmap, docs/status.md; 72 to 75
-- are 2a to 2d). Follows and needs 75 (20261130000000_campus_events.sql). Rollback:
-- supabase/rollbacks/20261201000000_campus_appointments.down.sql.
--
-- Until now nobody could be made a campus admin: 72 allowed the role on the staff list but no function granted it.
-- With every area a campus admin uses scoped (73 to 75), owners may now appoint them, always with their campuses:
--
-- 1. staff_role_permissions('campus_admin') adds 'campus.overview': the portal's campus dashboard, built only from the
--    scoped functions (their reports, flags, appeals and calendar); nobody else has it.
-- 2. staff_invites.university_ids (CampConnect Admin's invitations): the campuses an invitation to the role carries.
-- 3. A campus admin's campuses go with the role: leaving it (a role change) or the staff list deletes their
--    staff_campuses rows (staff_campuses_follow_role, on CampConnect Admin's staff and migration 41's staff_members).
-- 4. admin_campus_admin_add(email, universities) (owners, second factor): an existing confirmed account joins the staff
--    as a campus admin with those campuses at once; anyone else gets an invitation carrying them, sent and claimed the
--    usual way (migration 18's email, binding and expiry). 1 to 20 existing universities; never yourself, never someone
--    already on the staff. admin_campus_admin_set_campuses(user, universities) (owners): a campus admin's campuses,
--    replaced. admin_staff_campuses() (the staff list's readers): who acts for which campuses, members and invitations.
--    Each change is in staff_audit_log with the universities.
-- 5. staff_invite_for_caller() (resend, the email's result, withdraw): a campus admin's invitation is the owners' alone.
--    staff_claim_invite(): it is claimed only while its inviter is still an owner, and brings its campuses.
--
-- Unchanged: admin_staff_add and admin_staff_set_role still refuse the role (appointing goes through 4, with campuses);
-- admins may still remove a campus admin or change them to another role they can grant (both take access away or
-- give what an admin already gives anyone). Safe to run more than once.

-- -----------------------------------------------------------------------------
-- 1. The permission
-- -----------------------------------------------------------------------------
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
    when 'campus_admin' then array['campus.overview', 'moderation.view', 'users.view', 'content.view', 'security.self']
    else array[]::text[]
  end
$$;
revoke all on function public.staff_role_permissions(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Campuses follow the role
-- -----------------------------------------------------------------------------
create or replace function public.staff_campuses_follow_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' or new.role is distinct from 'campus_admin' then
    delete from public.staff_campuses c where c.user_id = old.user_id;
  end if;
  return null;
end;
$$;
revoke all on function public.staff_campuses_follow_role() from public, anon, authenticated;
drop trigger if exists staff_campuses_follow_role on public.staff_members;
create trigger staff_campuses_follow_role after update of role or delete on public.staff_members
  for each row execute function public.staff_campuses_follow_role();

do $do$
begin
  if to_regclass('public.staff_audit_log') is null or to_regclass('public.staff') is null then
    return;
  end if;

  -- 2. The campuses an invitation carries.
  execute 'alter table public.staff_invites add column if not exists university_ids uuid[] not null default ''{}''::uuid[]';
  execute 'drop trigger if exists staff_campuses_follow_role on public.staff';
  execute 'create trigger staff_campuses_follow_role after update of role or delete on public.staff for each row execute function public.staff_campuses_follow_role()';

  -- 5. Invitations to the role are the owners'.
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
  -- Migration 76: owners alone appoint campus admins, so they alone resend, record or withdraw such an invitation.
  if v_inv.role = 'campus_admin' and v_caller.role <> 'owner' then
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
    -- Migration 76: a campus admin's invitation holds only while its inviter is still an owner.
    if v_inviter_role is null or public.staff_grant_rank(v_inviter_role) < public.staff_role_rank(v_inv.role)
       or (v_inv.role = 'campus_admin' and v_inviter_role is distinct from 'owner') then
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
  -- Migration 76: a campus admin's campuses come with the invitation (those that still exist).
  if v_inv.role = 'campus_admin' then
    insert into public.staff_campuses (user_id, university_id, granted_by)
    select new.id, u.id, v_inv.invited_by from public.universities u where u.id = any (v_inv.university_ids)
    on conflict do nothing;
  end if;
  delete from public.staff_invites where email = v_email;
  insert into public.staff_audit_log (actor_id, actor_email, action, target_type, target_id, details)
  values (null, null, 'invite.accepted', 'user', new.id::text,
    jsonb_build_object('email', v_email, 'role', v_inv.role, 'invited_by', v_inv.invited_by,
      'via', case when v_inv.auth_user_id is not null then 'email link' else 'sign-up' end)
      || case when v_inv.role = 'campus_admin' then jsonb_build_object('universities', to_jsonb(v_inv.university_ids)) else '{}'::jsonb end);
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

  -- 4. Appointing. The universities: 1 to 20, each one that exists, repeats dropped.
  execute $ddl$
create or replace function public.staff_valid_campuses(p_universities uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(distinct x order by x), '{}'::uuid[]) into v_ids from unnest(coalesce(p_universities, '{}'::uuid[])) x where x is not null;
  if cardinality(v_ids) = 0 then
    raise exception 'Pick at least one campus';
  end if;
  if cardinality(v_ids) > 20 then
    raise exception 'Pick at most 20 campuses';
  end if;
  if exists (select 1 from unnest(v_ids) x where not exists (select 1 from public.universities u where u.id = x)) then
    raise exception 'Unknown campus';
  end if;
  return v_ids;
end;
$fn$
  $ddl$;
  execute 'revoke all on function public.staff_valid_campuses(uuid[]) from public, anon, authenticated';

  execute $ddl$
create or replace function public.admin_campus_admin_add(p_email text, p_universities uuid[])
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_caller public.staff;
  v_email text := lower(btrim(p_email));
  v_ids uuid[];
  v_target uuid;
  v_invite public.staff_invites;
begin
  v_caller := public.staff_require('owner');
  if not public.staff_valid_email(v_email) then
    raise exception 'Enter a valid email address';
  end if;
  v_ids := public.staff_valid_campuses(p_universities);
  v_target := public.staff_confirmed_user(v_email);
  if v_target = v_caller.user_id then
    raise exception 'You cannot change your own role';
  end if;
  if v_target is not null and exists (select 1 from public.staff s where s.user_id = v_target) then
    raise exception 'This person is already on the team. Change their role in the list instead.';
  end if;
  if v_target is not null then
    insert into public.staff (user_id, role, granted_by) values (v_target, 'campus_admin', v_caller.user_id);
    insert into public.staff_campuses (user_id, university_id, granted_by) select v_target, x, v_caller.user_id from unnest(v_ids) x;
    delete from public.staff_invites where email = v_email;
    perform public.staff_log('staff.add', 'user', v_target::text, jsonb_build_object('email', v_email, 'role', 'campus_admin', 'universities', to_jsonb(v_ids)));
    return 'added';
  end if;
  -- As admin_staff_add: a stranger's own unconfirmed sign-up blocks the invitation; one an invitation email created does not.
  if public.staff_stranger_signup_exists(v_email) then
    perform public.staff_assert_invitable(v_email);
  end if;
  insert into public.staff_invites (email, role, invited_by, university_ids) values (v_email, 'campus_admin', v_caller.user_id, v_ids)
  on conflict (email) do update set
    role = excluded.role,
    invited_by = excluded.invited_by,
    university_ids = excluded.university_ids,
    expires_at = now() + interval '7 days',
    created_at = case when staff_invites.auth_user_id is null then now() else staff_invites.created_at end;
  perform public.staff_log('invite.create', 'email', v_email, jsonb_build_object('role', 'campus_admin', 'universities', to_jsonb(v_ids)));
  return 'invited';
end;
$fn$
  $ddl$;
  execute 'revoke all on function public.admin_campus_admin_add(text, uuid[]) from public, anon';
  execute 'grant execute on function public.admin_campus_admin_add(text, uuid[]) to authenticated';

  execute $ddl$
create or replace function public.admin_campus_admin_set_campuses(p_user_id uuid, p_universities uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_caller public.staff;
  v_ids uuid[];
  v_before uuid[];
  v_email text;
begin
  v_caller := public.staff_require('owner');
  v_ids := public.staff_valid_campuses(p_universities);
  -- One change at a time per person, as the staff list's own functions do.
  perform 1 from public.staff s where s.user_id = p_user_id and s.role = 'campus_admin' for update;
  if not found then
    raise exception 'Not a campus admin';
  end if;
  select coalesce(array_agg(c.university_id order by c.university_id), '{}'::uuid[]) into v_before from public.staff_campuses c where c.user_id = p_user_id;
  if v_before = v_ids then
    return;
  end if;
  delete from public.staff_campuses c where c.user_id = p_user_id and not (c.university_id = any (v_ids));
  insert into public.staff_campuses (user_id, university_id, granted_by) select p_user_id, x, v_caller.user_id from unnest(v_ids) x
  on conflict do nothing;
  select lower(u.email::text) into v_email from auth.users u where u.id = p_user_id;
  perform public.staff_log('staff.campuses', 'user', p_user_id::text, jsonb_build_object('email', v_email, 'from', to_jsonb(v_before), 'to', to_jsonb(v_ids)));
end;
$fn$
  $ddl$;
  execute 'revoke all on function public.admin_campus_admin_set_campuses(uuid, uuid[]) from public, anon';
  execute 'grant execute on function public.admin_campus_admin_set_campuses(uuid, uuid[]) to authenticated';

  -- Who acts for which campuses, for the staff list (its readers: moderators and up, as admin_staff_list).
  execute $ddl$
create or replace function public.admin_staff_campuses()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  perform public.staff_require('moderator');
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('userId', s.user_id, 'universities', coalesce((
        select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
        from public.staff_campuses c join public.universities u on u.id = c.university_id where c.user_id = s.user_id), '[]'::jsonb)) order by s.created_at)
      from public.staff s where s.role = 'campus_admin'), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object('email', i.email, 'universities', coalesce((
        select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
        from public.universities u where u.id = any (i.university_ids)), '[]'::jsonb)) order by i.created_at)
      from public.staff_invites i where i.role = 'campus_admin'), '[]'::jsonb));
end;
$fn$
  $ddl$;
  execute 'revoke all on function public.admin_staff_campuses() from public, anon';
  execute 'grant execute on function public.admin_staff_campuses() to authenticated';
end
$do$;

notify pgrst, 'reload schema';

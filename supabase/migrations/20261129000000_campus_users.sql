-- Migration 74: users, suspensions and appeals scoped by campus (Phase 2c of the UniBuzz Master Admin Portal roadmap,
-- docs/status.md; 72 is 2a, 73 is 2b). Follows and needs 73 (20261128000000_campus_moderation.sql): staff_require_area(),
-- staff_campus_ids(), staff_content_university(), and 72's staff_can(). Rollback:
-- supabase/rollbacks/20261129000000_campus_users.down.sql.
--
-- Campus admins get 'users.view': the portal's Users pages (the list, search, a student's page, suspensions) answer a
-- campus admin for the verified students of their own campuses only, and the Appeals page (under 'moderation.view',
-- refused to them until now) for appeals by those students. Within a campus a campus admin keeps a moderator's powers:
-- appeals against a suspension or a ban stay admin-only, as Trust & Safety already rules for moderators.
--
-- 1. staff_role_permissions('campus_admin') is {moderation.view, users.view}.
-- 2. staff_user_university(user) (internal): the campus a person belongs to for staff scopes, their verified campus
--    (verified_university(): the confirmed email's domain), and **no campus for anyone on the staff list** (any role,
--    suspended or not): the platform's owners and admins manage the staff, so a campus admin never sees, suspends or
--    reviews another staff member. staff_content_university() now goes through it, so a staff member's content and
--    profile leave every campus admin's reach too.
-- 3. Trust & Safety: ts_require_area(permission) (internal): ts_require_staff() word for word for everyone but a campus
--    admin, who gets 'campus_admin' with the permission, a campus and the second factor. console_appeals and
--    console_decide_appeal call it; a campus admin sees and decides only their own students' appeals (others are "not
--    found"), never one against a suspension or a ban (ts_appeal_json and the decision already allow those to admins
--    only), and their decisions are recorded as 'campus_admin' (Trust & Safety's audit_log takes any role name;
--    moderation_actions, whose check keeps moderator, admin and system, is written only by the queue, still refused to
--    them).
-- 4. On CampConnect Admin's schema: admin_users_list, admin_user_search, admin_user_get, admin_restrictions_list,
--    admin_user_suspend and admin_user_unsuspend call staff_require_area('users.view') and scope by the person's campus;
--    someone out of scope is "User not found". For owners, admins and moderators every answer is as before, but one
--    rule is new for them: only an owner or an admin may suspend or lift a campus admin (staff_role_rank() gives the role
--    0 so that staff_require() never lets it in platform-wide, which left a moderator outranking it).
--
-- Still refused to campus admins: deleting content, the queue, events and organizations, the staff and every other
-- area. Nobody can be appointed campus admin yet (72). Safe to run more than once.

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
    when 'campus_admin' then array['moderation.view', 'users.view']
    else array[]::text[]
  end
$$;
revoke all on function public.staff_role_permissions(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Where a person belongs
-- -----------------------------------------------------------------------------
-- A person's verified campus, or none for anyone on the staff list (CampConnect Admin's staff, where it exists, and
-- migration 41's staff_members).
create or replace function public.staff_user_university(p_user uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_staff boolean := false;
begin
  if p_user is null then
    return null;
  end if;
  if to_regclass('public.staff') is not null then
    execute 'select exists (select 1 from public.staff s where s.user_id = $1)' into v_staff using p_user;
  end if;
  if not v_staff then
    select exists (select 1 from public.staff_members m where m.user_id = p_user) into v_staff;
  end if;
  if v_staff then
    return null;
  end if;
  return public.verified_university(p_user);
end;
$$;
revoke all on function public.staff_user_university(uuid) from public, anon, authenticated;

-- 73's placement of content, now through the author's place: a staff member's content belongs to no campus.
create or replace function public.staff_content_university(p_type text, p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_id is null or p_type is null
    or p_type not in ('post', 'comment', 'apartment', 'item', 'roommate', 'profile', 'buzz', 'buzz_comment', 'buzz_reply') then
    return null;
  end if;
  return public.staff_user_university(public.ts_author_of(p_type, p_id));
end;
$$;
revoke all on function public.staff_content_university(text, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Appeals
-- -----------------------------------------------------------------------------
-- The gate of a scoped Trust & Safety area: ts_require_staff() ('admin' or 'moderator') for everyone but a campus admin;
-- a campus admin gets 'campus_admin' with p_permission in their set, a campus and the second factor, in migration 41's
-- words otherwise.
create or replace function public.ts_require_area(p_permission text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if public.staff_role_of(v_me) is distinct from 'campus_admin' then
    return public.ts_require_staff();
  end if;
  if p_permission is null or not (p_permission = any (public.staff_role_permissions('campus_admin')))
    or cardinality(public.staff_campus_ids(v_me)) = 0 then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  if not public.ts_mfa_ok() then
    perform public.ts_fail('mfa_required', 'Confirm it''s you with your authenticator app to use the staff console.');
  end if;
  return 'campus_admin';
end;
$$;
revoke all on function public.ts_require_area(text) from public, anon, authenticated;

create or replace function public.console_appeals(p_view text default 'open', p_limit int default 30, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_area('moderation.view');
  v_me uuid := auth.uid();
  v_unis uuid[] := case when v_role = 'campus_admin' then public.staff_campus_ids(auth.uid()) else '{}'::uuid[] end;
  v_view text := case when p_view in ('open', 'upheld', 'reversed', 'reduced', 'all') then p_view else 'open' end;
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_ids uuid[];
begin
  select array_agg(id order by n) into v_ids from (
    select a.id, row_number() over (order by case when v_view = 'open' then a.created_at end asc, case when v_view <> 'open' then a.created_at end desc, a.id) as n
    from public.appeals a
    where a.user_id <> v_me and (v_view = 'all' or a.status = v_view)
      and (v_role <> 'campus_admin' or public.staff_user_university(a.user_id) = any (v_unis))
    order by n
    limit v_limit + 1 offset v_offset
  ) x;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(public.ts_appeal_json(i, v_me, v_role) order by o) from unnest(v_ids[1:v_limit]) with ordinality as t(i, o)), '[]'::jsonb),
    'nextOffset', case when coalesce(cardinality(v_ids), 0) > v_limit then v_offset + v_limit end);
end;
$$;

create or replace function public.console_decide_appeal(p_id uuid, p_outcome text, p_note text, p_reduced_until bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_area('moderation.view');
  v_me uuid := auth.uid();
  v_note text := btrim(coalesce(p_note, ''));
  a public.appeals;
  s public.user_sanctions;
  v_action_actor uuid;
  v_queue uuid;
  v_until timestamptz := public.ts_from_ms(p_reduced_until);
begin
  select * into a from public.appeals where id = p_id for update;
  if not found or a.user_id = v_me
    or (v_role = 'campus_admin' and not public.staff_can('moderation.view', public.staff_user_university(a.user_id))) then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  select * into s from public.user_sanctions where id = a.sanction_id for update;
  select m.actor_id into v_action_actor from public.moderation_actions m where m.id = s.action_id;
  if a.status <> 'open' then
    perform public.ts_fail('conflict', 'This appeal was already decided.');
  end if;
  if s.kind in ('suspension', 'ban') and v_role <> 'admin' then
    perform public.ts_fail('forbidden', 'Appeals against suspensions and bans are admin only.');
  end if;
  if v_action_actor = v_me or s.actor_id = v_me then
    perform public.ts_fail('forbidden', 'A different staff member must review this appeal.');
  end if;
  if p_outcome is null or p_outcome not in ('upheld', 'reversed', 'reduced') then
    perform public.ts_fail('validation_failed', 'Pick an outcome.');
  end if;
  if char_length(v_note) < 10 then
    perform public.ts_fail('validation_failed', 'Add a note (at least 10 characters).');
  end if;
  if p_outcome = 'reduced' then
    if v_until is null or v_until <= now() then
      perform public.ts_fail('validation_failed', 'Pick a new end time in the future.');
    end if;
    if s.expires_at is not null and v_until >= s.expires_at then
      perform public.ts_fail('validation_failed', 'A reduced sanction must end earlier than it does now.');
    end if;
  end if;
  select q.id into v_queue from public.mod_queue q where q.appeal_id = a.id order by q.created_at desc limit 1;

  update public.appeals set status = p_outcome, reviewer_id = v_me, outcome_note = v_note, decided_at = now() where id = a.id;
  if p_outcome = 'reversed' then
    perform public.ts_lift_sanction(s.id, v_me, v_role);
    if s.entity_type is not null and s.entity_id is not null and s.entity_type <> 'profile' then
      if public.ts_snapshot(s.entity_type, s.entity_id) is not null then
        perform public.ts_apply_content_status(s.entity_type, s.entity_id, 'active', null, s.category, s.id);
      end if;
      perform public.ts_revoke_strikes(s.entity_type, s.entity_id);
    end if;
  elsif p_outcome = 'reduced' then
    update public.user_sanctions set expires_at = v_until where id = s.id;
    perform public.ts_audit(v_me, v_role, 'sanction_reduce', 'appeal', a.id::text, v_queue, null, null, null,
                            jsonb_build_object('sanctionId', s.id, 'until', public.ts_ms(v_until)));
  end if;
  update public.mod_queue set status = 'closed', closed_at = now(), resolution = case when p_outcome = 'upheld' then 'dismissed' else 'approved' end,
                              claimed_by = null, claimed_at = null
  where appeal_id = a.id and status <> 'closed';
  perform public.ts_audit(v_me, v_role, 'appeal_decide', 'appeal', a.id::text, v_queue, null, null, v_note, jsonb_build_object('outcome', p_outcome));
  perform public.ts_notify(a.user_id, 'moderation',
    case p_outcome when 'reversed' then 'Your appeal was accepted.' when 'reduced' then 'Your appeal was reviewed: the sanction was reduced.'
                   else 'Your appeal was reviewed: the decision stands.' end,
    case p_outcome when 'reversed' then 'We got this one wrong. The sanction is lifted and any strike removed. Sorry about that.'
                   when 'reduced' then 'It now ends earlier. Details are in Account status.' else null end,
    '/settings/account-status', jsonb_build_object('event', 'appeal_result', 'outcome', p_outcome, 'sanctionId', s.id));
  return public.ts_appeal_json(a.id, v_me, v_role);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. CampConnect Admin's users, scoped
-- -----------------------------------------------------------------------------
do $do$
begin
  if to_regclass('public.staff_audit_log') is null or to_regclass('public.staff') is null then
    return;
  end if;

  -- The list (migration 65's), with the campus admin's scope.
  execute $ddl$
create or replace function public.admin_users_list(p_filter text default 'all', p_limit int default 50, p_before timestamptz default null)
returns table (user_id uuid, full_name text, email text, avatar_url text, university_name text, created_at timestamptz, last_seen_at timestamptz, suspended boolean, staff_role text)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_filter text := coalesce(p_filter, 'all');
  v_caller public.staff;
  v_platform boolean;
  v_unis uuid[];
begin
  v_caller := public.staff_require_area('users.view');
  v_platform := v_caller.role in ('owner', 'admin', 'moderator');
  v_unis := case when v_platform then '{}'::uuid[] else public.staff_campus_ids(v_caller.user_id) end;
  if v_filter not in ('all', 'suspended', 'staff', 'unverified') then
    raise exception 'Invalid filter';
  end if;
  return query
    select p.id, p.full_name, lower(u.email::text), p.avatar_url, un.name, p.created_at, p.last_seen_at, public.is_suspended(p.id), s.role
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join public.universities un on un.id = p.university_id
    left join public.staff s on s.user_id = p.id
    where (p_before is null or p.created_at < p_before)
      and (v_filter <> 'suspended' or public.is_suspended(p.id))
      and (v_filter <> 'staff' or s.user_id is not null)
      and (v_filter <> 'unverified' or u.email_confirmed_at is null or p.university_id is null)
      and (v_platform or public.staff_user_university(p.id) = any (v_unis))
    order by p.created_at desc, p.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$fn$
  $ddl$;

  execute $ddl$
create or replace function public.admin_user_search(p_q text, p_limit int default 20)
returns table (user_id uuid, full_name text, email text, avatar_url text, university_name text, created_at timestamptz, suspended boolean, staff_role text)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_term text := nullif(btrim(regexp_replace(coalesce(p_q, ''), '[%_,()"''\\]', ' ', 'g')), '');
  v_caller public.staff;
  v_platform boolean;
  v_unis uuid[];
begin
  v_caller := public.staff_require_area('users.view');
  v_platform := v_caller.role in ('owner', 'admin', 'moderator');
  v_unis := case when v_platform then '{}'::uuid[] else public.staff_campus_ids(v_caller.user_id) end;
  if v_term is null then
    return;
  end if;
  return query
    select p.id, p.full_name, lower(u.email::text), p.avatar_url, un.name, p.created_at, public.is_suspended(p.id), s.role
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join public.universities un on un.id = p.university_id
    left join public.staff s on s.user_id = p.id
    where (p.full_name ilike '%' || v_term || '%' or u.email::text ilike '%' || v_term || '%')
      and (v_platform or public.staff_user_university(p.id) = any (v_unis))
    order by (lower(u.email::text) = lower(v_term)) desc, p.full_name, p.id
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$fn$
  $ddl$;

  execute $ddl$
create or replace function public.admin_user_get(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_out jsonb;
begin
  perform public.staff_require_area('users.view');
  if not public.staff_can('users.view', public.staff_user_university(p_user_id)) then
    raise exception 'User not found';
  end if;
  select jsonb_build_object(
    'user_id', p.id,
    'full_name', p.full_name,
    'email', lower(u.email::text),
    'avatar_url', p.avatar_url,
    'bio', p.bio,
    'program', p.program,
    'university', un.name,
    'created_at', p.created_at,
    'last_seen_at', p.last_seen_at,
    'staff_role', (select s.role from public.staff s where s.user_id = p.id),
    'banned_until', u.banned_until,
    'counts', jsonb_build_object(
      'apartments', (select count(*) from public.apartments a where a.owner_id = p.id),
      'items', (select count(*) from public.items i where i.seller_id = p.id),
      'roommate_posts', (select count(*) from public.roommate_posts r where r.author_id = p.id),
      'posts', (select count(*) from public.feed_posts f where f.author_id = p.id),
      'comments', (select count(*) from public.post_comments c where c.user_id = p.id),
      'reports_filed', (select count(*) from public.reports r where r.reporter_id = p.id),
      'reports_against', (
        select count(*) from public.reports r
        where (r.target_type = 'profile' and r.target_id = p.id)
           or (r.target_type = 'apartment' and r.target_id in (select a.id from public.apartments a where a.owner_id = p.id))
           or (r.target_type = 'item' and r.target_id in (select i.id from public.items i where i.seller_id = p.id))
           or (r.target_type = 'roommate' and r.target_id in (select x.id from public.roommate_posts x where x.author_id = p.id))
           or (r.target_type = 'post' and r.target_id in (select f.id from public.feed_posts f where f.author_id = p.id))
           or (r.target_type = 'comment' and r.target_id in (select c.id from public.post_comments c where c.user_id = p.id))
           or (r.target_type = 'message' and r.target_id in (select m.id from public.messages m where m.sender_id = p.id))
      )
    ),
    'active_restriction', (
      select to_jsonb(ar) from (
        select r.id, r.kind, r.reason, r.internal_note, r.expires_at, r.created_at, r.created_by, cb.full_name as created_by_name
        from public.account_restrictions r
        left join public.profiles cb on cb.id = r.created_by
        where r.user_id = p.id and r.lifted_at is null and (r.expires_at is null or r.expires_at > now())
        limit 1
      ) ar
    ),
    'restrictions', coalesce((
      select jsonb_agg(to_jsonb(hr) order by hr.created_at desc) from (
        select r.id, r.kind, r.reason, r.internal_note, r.expires_at, r.created_at, r.created_by, cb.full_name as created_by_name,
          r.lifted_at, r.lifted_by, lb.full_name as lifted_by_name, r.lift_note,
          (r.lifted_at is null and (r.expires_at is null or r.expires_at > now())) as active
        from public.account_restrictions r
        left join public.profiles cb on cb.id = r.created_by
        left join public.profiles lb on lb.id = r.lifted_by
        where r.user_id = p.id
      ) hr
    ), '[]'::jsonb)
  )
  into v_out
  from public.profiles p
  left join auth.users u on u.id = p.id
  left join public.universities un on un.id = p.university_id
  where p.id = p_user_id;
  if v_out is null then
    raise exception 'User not found';
  end if;
  return v_out;
end;
$fn$
  $ddl$;

  execute $ddl$
create or replace function public.admin_restrictions_list(p_active_only boolean default true, p_limit int default 50)
returns table (
  id uuid, user_id uuid, full_name text, email text, kind text, reason text, internal_note text, expires_at timestamptz,
  created_by uuid, created_by_name text, created_at timestamptz, lifted_at timestamptz, lifted_by_name text, lift_note text, active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_caller public.staff;
  v_platform boolean;
  v_unis uuid[];
begin
  v_caller := public.staff_require_area('users.view');
  v_platform := v_caller.role in ('owner', 'admin', 'moderator');
  v_unis := case when v_platform then '{}'::uuid[] else public.staff_campus_ids(v_caller.user_id) end;
  return query
    select r.id, r.user_id, p.full_name, lower(u.email::text), r.kind, r.reason, r.internal_note, r.expires_at,
      r.created_by, c.full_name, r.created_at, r.lifted_at, l.full_name, r.lift_note,
      (r.lifted_at is null and (r.expires_at is null or r.expires_at > now()))
    from public.account_restrictions r
    left join public.profiles p on p.id = r.user_id
    left join auth.users u on u.id = r.user_id
    left join public.profiles c on c.id = r.created_by
    left join public.profiles l on l.id = r.lifted_by
    where (not coalesce(p_active_only, true) or (r.lifted_at is null and (r.expires_at is null or r.expires_at > now())))
      and (v_platform or public.staff_user_university(r.user_id) = any (v_unis))
    order by r.created_at desc, r.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$fn$
  $ddl$;

  -- Suspending and lifting: someone out of the caller's scope is not found; a campus admin is protected from anyone
  -- below an admin (staff_role_rank() gives the role 0, so the rank test alone would let a moderator act on them).
  execute $ddl$
create or replace function public.admin_user_suspend(p_user_id uuid, p_reason text, p_expires_at timestamptz default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_caller public.staff;
  v_target_role text;
  v_reason text := btrim(p_reason);
  v_email text;
  v_id uuid;
begin
  v_caller := public.staff_require_area('users.view');
  if p_user_id is null or not exists (select 1 from public.profiles p where p.id = p_user_id)
    or not public.staff_can('users.view', public.staff_user_university(p_user_id)) then
    raise exception 'User not found';
  end if;
  if p_user_id = v_caller.user_id then
    raise exception 'You cannot suspend yourself';
  end if;
  select s.role into v_target_role from public.staff s where s.user_id = p_user_id;
  if v_target_role is not null and public.staff_role_rank(v_caller.role) <= public.staff_role_rank(v_target_role) then
    raise exception 'Not allowed';
  end if;
  if v_target_role = 'campus_admin' and public.staff_role_rank(v_caller.role) < public.staff_role_rank('admin') then
    raise exception 'Not allowed';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 500 then
    raise exception 'Give a reason of 3 to 500 characters';
  end if;
  if p_note is not null and char_length(p_note) > 2000 then
    raise exception 'Keep the note under 2,000 characters';
  end if;
  if p_expires_at is not null and (not isfinite(p_expires_at) or p_expires_at <= now() or p_expires_at > now() + interval '100 years') then
    raise exception 'The end date must be in the future (and within 100 years)';
  end if;
  -- Two staff acting on the same person at the same moment: the second waits and sees the first's row.
  perform pg_advisory_xact_lock(hashtext('restriction:' || p_user_id::text));

  select r.id into v_id
  from public.account_restrictions r
  where r.user_id = p_user_id and r.lifted_at is null and (r.expires_at is null or r.expires_at > now());
  if v_id is not null then
    update public.account_restrictions
    set reason = v_reason, expires_at = p_expires_at, internal_note = p_note
    where id = v_id;
  else
    -- A suspension that ran out on its own is closed at the moment it ended (nobody lifted it).
    update public.account_restrictions
    set lifted_at = coalesce(expires_at, now()), lift_note = coalesce(lift_note, 'Expired')
    where user_id = p_user_id and lifted_at is null;
    insert into public.account_restrictions (user_id, kind, reason, internal_note, expires_at, created_by)
    values (p_user_id, 'suspension', v_reason, p_note, p_expires_at, v_caller.user_id)
    returning id into v_id;
  end if;

  update auth.users set banned_until = coalesce(p_expires_at, now() + interval '100 years') where id = p_user_id;
  select lower(u.email::text) into v_email from auth.users u where u.id = p_user_id;
  perform public.staff_log('user.suspend', 'user', p_user_id::text,
    jsonb_build_object('email', v_email, 'reason', v_reason, 'expires_at', p_expires_at, 'note', p_note));
  return v_id;
end;
$fn$
  $ddl$;

  execute $ddl$
create or replace function public.admin_user_unsuspend(p_user_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_caller public.staff;
  v_target_role text;
  v_email text;
  v_id uuid;
begin
  v_caller := public.staff_require_area('users.view');
  if p_user_id is null or not exists (select 1 from public.profiles p where p.id = p_user_id)
    or not public.staff_can('users.view', public.staff_user_university(p_user_id)) then
    raise exception 'User not found';
  end if;
  select s.role into v_target_role from public.staff s where s.user_id = p_user_id;
  if v_target_role is not null and public.staff_role_rank(v_caller.role) <= public.staff_role_rank(v_target_role) then
    raise exception 'Not allowed';
  end if;
  if v_target_role = 'campus_admin' and public.staff_role_rank(v_caller.role) < public.staff_role_rank('admin') then
    raise exception 'Not allowed';
  end if;
  if p_note is not null and char_length(p_note) > 2000 then
    raise exception 'Keep the note under 2,000 characters';
  end if;
  perform pg_advisory_xact_lock(hashtext('restriction:' || p_user_id::text));
  select r.id into v_id
  from public.account_restrictions r
  where r.user_id = p_user_id and r.lifted_at is null and (r.expires_at is null or r.expires_at > now());
  if v_id is null then
    raise exception 'Not suspended';
  end if;
  update public.account_restrictions
  set lifted_at = now(), lifted_by = v_caller.user_id, lift_note = p_note
  where id = v_id;
  update auth.users set banned_until = null where id = p_user_id;
  select lower(u.email::text) into v_email from auth.users u where u.id = p_user_id;
  perform public.staff_log('user.unsuspend', 'user', p_user_id::text, jsonb_build_object('email', v_email, 'note', p_note));
end;
$fn$
  $ddl$;
end
$do$;

notify pgrst, 'reload schema';

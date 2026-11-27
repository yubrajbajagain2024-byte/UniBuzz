-- Migration 75: events, organizations and the content browser scoped by campus (Phase 2d of the UniBuzz Master Admin
-- Portal roadmap, docs/status.md; 72 to 74 are 2a to 2c). Follows and needs 74 (20261129000000_campus_users.sql):
-- ts_require_area(), staff_require_area(), staff_campus_ids(), staff_content_university(), 72's staff_can(). Rollback:
-- supabase/rollbacks/20261130000000_campus_events.down.sql.
--
-- Campus admins get 'content.view': the portal's Events page (their campus's calendar) and Content page (hidden
-- content), for their own campuses only; and 'security.self', the portal's Security page for their own account (their
-- second factor, which every scoped function asks for, and their password; nobody else's). With it every permission a
-- campus admin holds is scoped in SQL or is about themselves; what they may not do (the queue, the staff, universities,
-- businesses, analytics, settings, deleting content, feeds) stays refused.
--
-- 1. staff_role_permissions('campus_admin') is {moderation.view, users.view, content.view, security.self}.
-- 2. Events and organizations belong to the campus whose calendar shows them: their own university_id (an
--    organization's comes from its creator's profile, an event's from its organization or its feed, a feed's from the
--    admin who added it). Unlike a student's content (73, by its author's verified campus) this is about where the row
--    appears, which is what a campus admin governs: publishing, hiding and verifying on their calendar. The console
--    shows only public details about people (an organization creator's username). events_console_events, _counts,
--    _feeds, _organizations, _set_event and _set_organization call ts_require_area('content.view'): a campus admin sees
--    and changes only their campuses' rows (others are "not found"), recorded as 'campus_admin'. Feeds stay read-only
--    for them: saving and deleting a feed stay admin-only (ts_require_admin).
-- 3. CampConnect Admin's admin_hidden_content_list on staff_require_area('content.view'), each row's campus by
--    staff_content_university() (the author's verified campus; staff members' content, messages and stories: none).
--
-- For owners, admins and moderators every answer is as before. Nobody can be appointed campus admin yet (72). Safe to
-- run more than once.

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
    when 'campus_admin' then array['moderation.view', 'users.view', 'content.view', 'security.self']
    else array[]::text[]
  end
$$;
revoke all on function public.staff_role_permissions(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Events and organizations
-- -----------------------------------------------------------------------------
create or replace function public.events_console_events(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text := nullif(p_filter ->> 'status', '');
  v_source text := nullif(p_filter ->> 'source', '');
  v_university uuid := nullif(p_filter ->> 'university_id', '')::uuid;
  v_q text := nullif(btrim(coalesce(p_filter ->> 'q', '')), '');
  v_offset integer := greatest(0, coalesce((p_filter ->> 'offset')::integer, 0));
  v_limit integer := least(100, greatest(1, coalesce((p_filter ->> 'limit')::integer, 50)));
  v_upcoming boolean := coalesce((p_filter ->> 'upcoming')::boolean, true);
  v_items jsonb;
  v_total integer;
  v_role text := public.ts_require_area('content.view');
  v_unis uuid[] := case when v_role = 'campus_admin' then public.staff_campus_ids(auth.uid()) else '{}'::uuid[] end;
begin
  select count(*) into v_total from public.events e
  where (v_status is null or e.status = v_status) and (v_source is null or e.source = v_source)
    and (v_university is null or e.university_id = v_university)
    and (v_role <> 'campus_admin' or e.university_id = any (v_unis))
    and (not v_upcoming or coalesce(e.ends_at, e.starts_at) >= now() - interval '1 day')
    and (v_q is null or e.tsv @@ websearch_to_tsquery('simple', v_q));
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into v_items from (
    select e.id, e.title, e.starts_at, e.ends_at, e.all_day, e.location, e.category, e.image_url, e.registration_url, e.source, e.status,
      e.save_count, e.click_count, e.created_at, e.updated_at, e.university_id, u.name as university_name,
      e.organization_id, o.name as organization_name, o.verified as organization_verified, e.feed_id, f.name as feed_name
    from public.events e
    join public.universities u on u.id = e.university_id
    left join public.organizations o on o.id = e.organization_id
    left join public.event_feeds f on f.id = e.feed_id
    where (v_status is null or e.status = v_status) and (v_source is null or e.source = v_source)
      and (v_university is null or e.university_id = v_university)
    and (v_role <> 'campus_admin' or e.university_id = any (v_unis))
      and (not v_upcoming or coalesce(e.ends_at, e.starts_at) >= now() - interval '1 day')
      and (v_q is null or e.tsv @@ websearch_to_tsquery('simple', v_q))
    order by e.starts_at asc
    offset v_offset limit v_limit
  ) x;
  return jsonb_build_object('items', v_items, 'total', v_total);
end;
$$;

create or replace function public.events_console_set_event(p_event uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_area('content.view');
  v_old text;
  v_uni uuid;
begin
  if p_status not in ('scheduled', 'cancelled', 'hidden') then
    perform public.ts_fail('validation_failed', 'Unknown status.');
  end if;
  select e.status, e.university_id into v_old, v_uni from public.events e where e.id = p_event;
  if v_old is null or not public.staff_can('content.view', v_uni) then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  perform set_config('app.events_console', 'on', true);
  update public.events set status = p_status where id = p_event;
  perform public.ts_audit(auth.uid(), v_role, 'event.' || p_status, 'event', p_event::text, null, null, null, nullif(btrim(coalesce(p_note, '')), ''), jsonb_build_object('from', v_old));
  return jsonb_build_object('id', p_event, 'status', p_status);
end;
$$;

create or replace function public.events_console_feeds()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_area('content.view');
  v_unis uuid[] := case when v_role = 'campus_admin' then public.staff_campus_ids(auth.uid()) else '{}'::uuid[] end;
begin
  return (
    select coalesce(jsonb_agg(row_to_json(x) order by x.university_name, x.name), '[]'::jsonb) from (
      select f.id, f.university_id, u.name as university_name, f.organization_id, o.name as organization_name, f.name, f.url, f.kind, f.enabled,
        f.default_category, f.last_synced_at, f.last_status, f.last_error, f.items_seen, f.created_at, f.updated_at,
        (select count(*) from public.events e where e.feed_id = f.id and e.status in ('scheduled', 'cancelled') and coalesce(e.ends_at, e.starts_at) >= now()) as upcoming
      from public.event_feeds f
      join public.universities u on u.id = f.university_id
      left join public.organizations o on o.id = f.organization_id
      where v_role <> 'campus_admin' or f.university_id = any (v_unis)
    ) x
  );
end;
$$;

create or replace function public.events_console_organizations(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_verified boolean := (p_filter ->> 'verified')::boolean;
  v_status text := nullif(p_filter ->> 'status', '');
  v_q text := nullif(btrim(coalesce(p_filter ->> 'q', '')), '');
  v_role text := public.ts_require_area('content.view');
  v_unis uuid[] := case when v_role = 'campus_admin' then public.staff_campus_ids(auth.uid()) else '{}'::uuid[] end;
begin
  return (
    select coalesce(jsonb_agg(row_to_json(x) order by x.verified, x.created_at desc), '[]'::jsonb) from (
      select o.id, o.university_id, u.name as university_name, o.name, o.kind, o.description, o.avatar_url, o.website, o.verified, o.verified_at,
        o.status, o.follower_count, o.created_at, o.created_by,
        (select p.username from public.profiles p where p.id = o.created_by) as creator_username,
        (select count(*) from public.organization_members m where m.organization_id = o.id) as members,
        (select count(*) from public.events e where e.organization_id = o.id) as events
      from public.organizations o
      join public.universities u on u.id = o.university_id
      where (v_verified is null or o.verified = v_verified) and (v_status is null or o.status = v_status)
        and (v_q is null or o.name ilike '%' || v_q || '%')
        and (v_role <> 'campus_admin' or o.university_id = any (v_unis))
      limit 200
    ) x
  );
end;
$$;

create or replace function public.events_console_set_organization(p_org uuid, p_verified boolean default null, p_status text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_area('content.view');
  v_old public.organizations;
  v_verified boolean;
  v_status text;
begin
  select * into v_old from public.organizations o where o.id = p_org;
  if v_old.id is null or not public.staff_can('content.view', v_old.university_id) then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  v_verified := coalesce(p_verified, v_old.verified);
  v_status := coalesce(p_status, v_old.status);
  if v_status not in ('active', 'hidden') then
    perform public.ts_fail('validation_failed', 'Unknown status.');
  end if;
  perform set_config('app.events_console', 'on', true);
  update public.organizations set verified = v_verified,
    verified_at = case when v_verified and not v_old.verified then now() when v_verified then verified_at else null end,
    verified_by = case when v_verified and not v_old.verified then auth.uid() when v_verified then verified_by else null end,
    status = v_status
  where id = p_org;
  if v_verified and not v_old.verified then
    update public.events set status = 'scheduled' where organization_id = p_org and status = 'pending';
  elsif v_old.verified and not v_verified then
    update public.events set status = 'pending' where organization_id = p_org and status in ('scheduled', 'cancelled');
  end if;
  perform public.ts_audit(auth.uid(), v_role, 'organization.' || case when v_verified <> v_old.verified then (case when v_verified then 'verify' else 'unverify' end) else v_status end,
    'organization', p_org::text, null, null, null, nullif(btrim(coalesce(p_note, '')), ''), jsonb_build_object('name', v_old.name, 'verified', v_verified, 'status', v_status));
  return jsonb_build_object('id', p_org, 'verified', v_verified, 'status', v_status);
end;
$$;

create or replace function public.events_console_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_area('content.view');
  v_unis uuid[] := case when v_role = 'campus_admin' then public.staff_campus_ids(auth.uid()) else '{}'::uuid[] end;
begin
  return jsonb_build_object(
    'organizations_pending', (select count(*) from public.organizations o where not o.verified and o.status = 'active' and (v_role <> 'campus_admin' or o.university_id = any (v_unis))),
    'feeds_failing', (select count(*) from public.event_feeds f where f.enabled and f.last_status = 'error' and (v_role <> 'campus_admin' or f.university_id = any (v_unis))),
    'events_upcoming', (select count(*) from public.events e where e.status = 'scheduled' and e.starts_at >= now() and (v_role <> 'campus_admin' or e.university_id = any (v_unis)))
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. CampConnect Admin's content browser
-- -----------------------------------------------------------------------------
do $do$
begin
  if to_regclass('public.staff_audit_log') is null or to_regclass('public.staff') is null then
    return;
  end if;
  execute $ddl$
create or replace function public.admin_hidden_content_list(p_type text default null, p_limit int default 50, p_before timestamptz default null)
returns table (target_type text, target_id uuid, hidden_at timestamptz, hidden_reason text, title text, preview text, author_id uuid, author_name text, created_at timestamptz)
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
  v_caller := public.staff_require_area('content.view');
  v_platform := v_caller.role in ('owner', 'admin', 'moderator');
  v_unis := case when v_platform then '{}'::uuid[] else public.staff_campus_ids(v_caller.user_id) end;
  if p_type is not null and public.admin_content_table(p_type) is null then
    raise exception 'Invalid content type';
  end if;
  return query
    select h.target_type, h.target_id, h.hidden_at, h.hidden_reason, h.title, h.preview, h.author_id, h.author_name, h.created_at
    from (
      select 'apartment'::text as target_type, a.id as target_id, a.hidden_at, a.hidden_reason, a.title::text as title, left(a.description, 140)::text as preview, a.owner_id as author_id, p.full_name::text as author_name, a.created_at
      from public.apartments a left join public.profiles p on p.id = a.owner_id where a.hidden_at is not null
      union all
      select 'item', i.id, i.hidden_at, i.hidden_reason, i.title, left(i.description, 140), i.seller_id, p.full_name, i.created_at
      from public.items i left join public.profiles p on p.id = i.seller_id where i.hidden_at is not null
      union all
      select 'roommate', r.id, r.hidden_at, r.hidden_reason, r.title, left(r.description, 140), r.author_id, p.full_name, r.created_at
      from public.roommate_posts r left join public.profiles p on p.id = r.author_id where r.hidden_at is not null
      union all
      select 'post', f.id, f.hidden_at, f.hidden_reason, null, left(f.body, 140), f.author_id, p.full_name, f.created_at
      from public.feed_posts f left join public.profiles p on p.id = f.author_id where f.hidden_at is not null
      union all
      select 'comment', c.id, c.hidden_at, c.hidden_reason, null, left(c.body, 140), c.user_id, p.full_name, c.created_at
      from public.post_comments c left join public.profiles p on p.id = c.user_id where c.hidden_at is not null
      union all
      select 'message', m.id, m.hidden_at, m.hidden_reason, null, left(m.content, 140), m.sender_id, p.full_name, m.created_at
      from public.messages m left join public.profiles p on p.id = m.sender_id where m.hidden_at is not null
      union all
      select 'buzz', b.id, b.hidden_at, b.hidden_reason, b.title, left(b.body, 140), null::uuid, null::text, b.visible_at
      from public.buzz_posts b where b.hidden_at is not null
      union all
      select 'buzz_comment', bc.id, bc.hidden_at, bc.hidden_reason, null, left(bc.body, 140), null::uuid, null::text, bc.visible_at
      from public.buzz_comments bc where bc.hidden_at is not null
    ) h
    where (p_type is null or h.target_type = p_type)
      and (p_before is null or h.hidden_at < p_before)
      and (v_platform or public.staff_content_university(h.target_type, h.target_id) = any (v_unis))
    order by h.hidden_at desc, h.target_id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$fn$
  $ddl$;
end
$do$;

notify pgrst, 'reload schema';

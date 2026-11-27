-- Rollback of migration 73 (20261128000000_campus_moderation.sql): the moderation area scoped by campus. Run in one
-- transaction with
--   delete from public._migrations where name = '20261128000000_campus_moderation.sql';
-- then notify pgrst, 'reload schema'.
--
-- It takes 'moderation.view' back from campus admins (72's table: they have nothing) and puts the ten CampConnect Admin
-- functions back as 64, the moderation support and the dashboard migrations left them (staff_require, which refuses
-- campus admins), word for word; then it drops staff_require_area(), staff_campus_ids() and staff_content_university().
-- Nothing is refused: a campus admin only loses what 73 gave. Migration 72 stays.

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

do $do$
begin
  if to_regclass('public.staff_audit_log') is null or to_regclass('public.staff') is null then
    return;
  end if;
  execute $ddl$
create or replace function public.admin_reports_list(p_status text default 'open', p_limit int default 50, p_before timestamptz default null)
returns table (
  id uuid, reporter_id uuid, reporter_name text, reporter_email text, target_type text, target_id uuid, reason text, details text,
  status text, decision text, notes text, reviewed_by uuid, reviewer_name text, reviewed_at timestamptz, created_at timestamptz,
  target_preview text, target_hidden boolean, target_exists boolean, target_author_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_status text := coalesce(p_status, 'open');
begin
  perform public.staff_require('moderator');
  if v_status not in ('open', 'reviewed', 'dismissed', 'all') then
    raise exception 'Invalid status';
  end if;
  return query
    select r.id, r.reporter_id, rp.full_name, lower(ru.email::text), r.target_type, r.target_id, r.reason, r.details,
      r.status, r.decision, r.notes, r.reviewed_by, vp.full_name, r.reviewed_at, r.created_at,
      case when r.target_type = 'profile' then coalesce(left(tp.full_name, 140), '')
           else coalesce(left(coalesce(nullif(s.snap ->> 'title', ''), s.snap ->> 'body'), 140), '') end,
      case when r.target_type = 'profile' then tp.id is not null and public.is_suspended(tp.id)
           else s.snap ->> 'hidden_at' is not null end,
      case when r.target_type = 'profile' then tp.id is not null else s.snap is not null end,
      case when r.target_type = 'profile' then tp.id
           when r.target_type in ('buzz', 'buzz_comment') then null
           else (s.snap ->> 'author_id')::uuid end
    from public.reports r
    left join public.profiles rp on rp.id = r.reporter_id
    left join auth.users ru on ru.id = r.reporter_id
    left join public.profiles vp on vp.id = r.reviewed_by
    left join public.profiles tp on r.target_type = 'profile' and tp.id = r.target_id
    left join lateral (select case when r.target_type <> 'profile' then public.admin_content_snapshot(r.target_type, r.target_id) end as snap) s on true
    where (v_status = 'all' or r.status = v_status or (v_status = 'reviewed' and r.status = 'actioned'))
      and (p_before is null or r.created_at < p_before)
    order by r.created_at desc, r.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$fn$
  $ddl$;
  execute $ddl$
create or replace function public.admin_report_get(p_id uuid)
returns table (
  id uuid, reporter_id uuid, reporter_name text, reporter_email text, target_type text, target_id uuid, reason text, details text,
  status text, decision text, notes text, reviewed_by uuid, reviewer_name text, reviewed_at timestamptz, created_at timestamptz,
  target_preview text, target_hidden boolean, target_exists boolean, target_author_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  perform public.staff_require('moderator');
  return query
    select r.id, r.reporter_id, rp.full_name, lower(ru.email::text), r.target_type, r.target_id, r.reason, r.details,
      r.status, r.decision, r.notes, r.reviewed_by, vp.full_name, r.reviewed_at, r.created_at,
      case when r.target_type = 'profile' then coalesce(left(tp.full_name, 140), '')
           else coalesce(left(coalesce(nullif(s.snap ->> 'title', ''), s.snap ->> 'body'), 140), '') end,
      case when r.target_type = 'profile' then tp.id is not null and public.is_suspended(tp.id)
           else s.snap ->> 'hidden_at' is not null end,
      case when r.target_type = 'profile' then tp.id is not null else s.snap is not null end,
      case when r.target_type = 'profile' then tp.id
           when r.target_type in ('buzz', 'buzz_comment') then null
           else (s.snap ->> 'author_id')::uuid end
    from public.reports r
    left join public.profiles rp on rp.id = r.reporter_id
    left join auth.users ru on ru.id = r.reporter_id
    left join public.profiles vp on vp.id = r.reviewed_by
    left join public.profiles tp on r.target_type = 'profile' and tp.id = r.target_id
    left join lateral (select case when r.target_type <> 'profile' then public.admin_content_snapshot(r.target_type, r.target_id) end as snap) s on true
    where r.id = p_id;
  if not found then
    raise exception 'Report not found';
  end if;
end;
$fn$
  $ddl$;
  execute $ddl$
create or replace function public.admin_report_resolve(p_id uuid, p_decision text, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_caller public.staff;
  v_report public.reports;
begin
  v_caller := public.staff_require('moderator');
  if p_decision is null or p_decision not in ('dismissed', 'content_hidden', 'content_deleted', 'user_suspended', 'warning', 'no_action') then
    raise exception 'Invalid decision';
  end if;
  if p_notes is not null and char_length(p_notes) > 2000 then
    raise exception 'Keep the notes under 2,000 characters';
  end if;
  select * into v_report from public.reports r where r.id = p_id;
  if v_report.id is null then
    raise exception 'Report not found';
  end if;
  update public.reports
  set status = case when p_decision = 'dismissed' then 'dismissed' else 'reviewed' end,
      reviewed_by = v_caller.user_id, reviewed_at = now(), decision = p_decision, notes = p_notes
  where id = p_id;
  perform public.staff_log('report.resolve', 'report', p_id::text,
    jsonb_build_object('decision', p_decision, 'notes', p_notes, 'target_type', v_report.target_type, 'target_id', v_report.target_id));
end;
$fn$
  $ddl$;
  execute $ddl$
create or replace function public.admin_report_reopen(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_caller public.staff;
  v_report public.reports;
begin
  v_caller := public.staff_require('moderator');
  select * into v_report from public.reports r where r.id = p_id;
  if v_report.id is null then
    raise exception 'Report not found';
  end if;
  update public.reports
  set status = 'open', reviewed_by = null, reviewed_at = null, decision = null, notes = null
  where id = p_id;
  perform public.staff_log('report.reopen', 'report', p_id::text,
    jsonb_build_object('target_type', v_report.target_type, 'target_id', v_report.target_id, 'previous_status', v_report.status, 'previous_decision', v_report.decision));
end;
$fn$
  $ddl$;
  execute $ddl$
create or replace function public.admin_auto_hidden_list(
  p_status text default 'pending', p_limit int default 50, p_before timestamptz default null, p_target_type text default null, p_target_id uuid default null
)
returns table (
  id uuid, target_type text, target_id uuid, source text, reporter_count int, reasons jsonb, hidden_at timestamptz, created_at timestamptz,
  status text, reviewed_by uuid, reviewer_name text, reviewed_at timestamptz, review_note text,
  target_exists boolean, target_hidden boolean, title text, preview text, author_id uuid, author_name text
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_status text := coalesce(p_status, 'pending');
begin
  perform public.staff_require('moderator');
  if v_status not in ('pending', 'upheld', 'restored', 'deleted', 'all') then
    raise exception 'Invalid status';
  end if;
  return query
    select f.id, f.target_type, f.target_id, f.source, f.reporter_count, f.reasons, f.hidden_at, f.created_at,
      f.status, f.reviewed_by, vp.full_name, f.reviewed_at, f.review_note,
      s.snap is not null,
      coalesce(s.snap ->> 'hidden_at' is not null, false),
      nullif(s.snap ->> 'title', ''),
      coalesce(left(s.snap ->> 'body', 140), ''),
      case when f.target_type in ('buzz', 'buzz_comment') then null else (s.snap ->> 'author_id')::uuid end,
      case when f.target_type in ('buzz', 'buzz_comment') then null else s.snap ->> 'author_name' end
    from public.report_auto_hides f
    left join public.profiles vp on vp.id = f.reviewed_by
    left join lateral (select public.admin_content_snapshot(f.target_type, f.target_id) as snap) s on true
    where (v_status = 'all' or f.status = v_status)
      and (p_before is null or f.created_at < p_before)
      and (p_target_type is null or f.target_type = p_target_type)
      and (p_target_id is null or f.target_id = p_target_id)
    order by f.created_at desc, f.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$fn$
  $ddl$;
  execute $ddl$
create or replace function public.admin_auto_hidden_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v jsonb;
begin
  perform public.staff_require('moderator');
  select jsonb_build_object(
    'pending', count(*) filter (where f.status = 'pending'),
    'upheld', count(*) filter (where f.status = 'upheld'),
    'restored', count(*) filter (where f.status = 'restored'),
    'deleted', count(*) filter (where f.status = 'deleted'))
  into v
  from public.report_auto_hides f;
  return v;
end;
$fn$
  $ddl$;
  execute $ddl$
create or replace function public.admin_auto_hide_uphold(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_caller public.staff;
  v_note text := nullif(btrim(p_note), '');
  v_flag public.report_auto_hides;
  v_before jsonb;
begin
  v_caller := public.staff_require('moderator');
  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'Keep the note under 2,000 characters';
  end if;
  select * into v_flag from public.report_auto_hides f where f.id = p_id for update;
  if v_flag.id is null then
    raise exception 'Flag not found';
  end if;
  if v_flag.status <> 'pending' then
    raise exception 'This flag was already reviewed';
  end if;
  if public.report_hidden_at(v_flag.target_type, v_flag.target_id) is null then
    raise exception 'Content is not hidden';
  end if;
  perform public.report_auto_hide_assert_reviewer(v_flag.target_type, v_flag.target_id, v_caller.user_id, v_caller.role);
  v_before := public.ts_snapshot(v_flag.target_type, v_flag.target_id);
  update public.report_auto_hides f
  set status = 'upheld', reviewed_by = v_caller.user_id, reviewed_at = now(), review_note = v_note
  where f.id = p_id;
  perform set_config('app.moderation', 'on', true);
  execute format('update public.%I set hidden_reason = $1 where id = $2 and hidden_at is not null', public.admin_content_table(v_flag.target_type))
    using 'Kept hidden after review', v_flag.target_id;
  perform set_config('app.moderation', '', true);
  perform public.report_auto_hide_close(v_flag.target_type, v_flag.target_id, 'actioned', 'content_hidden', v_caller.user_id, v_note, 'removed');
  perform public.report_auto_hide_tell_owner(v_flag.target_type, public.ts_author_of(v_flag.target_type, v_flag.target_id), v_before, 'content_kept_hidden');
  perform public.staff_log('content.auto_hide_upheld', v_flag.target_type, v_flag.target_id::text,
    jsonb_build_object('target_type', v_flag.target_type, 'target_id', v_flag.target_id, 'flag_id', v_flag.id,
      'reporter_count', v_flag.reporter_count, 'note', v_note));
end;
$fn$
  $ddl$;
  execute $ddl$
create or replace function public.admin_content_get(p_target_type text, p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_snap jsonb;
begin
  perform public.staff_require('moderator');
  if public.admin_content_table(p_target_type) is null then
    raise exception 'Invalid content type';
  end if;
  v_snap := public.admin_content_snapshot(p_target_type, p_target_id);
  if v_snap is null then
    raise exception 'Content not found';
  end if;
  if p_target_type in ('buzz', 'buzz_comment') then
    perform public.staff_log('content.view', p_target_type, p_target_id::text, jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id));
  end if;
  return v_snap;
end;
$fn$
  $ddl$;
  execute $ddl$
create or replace function public.admin_content_hide(p_target_type text, p_target_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_caller public.staff;
  v_reason text := btrim(p_reason);
begin
  v_caller := public.staff_require('moderator');
  if public.admin_content_table(p_target_type) is null then
    raise exception 'Invalid content type';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 500 then
    raise exception 'Give a reason of 3 to 500 characters';
  end if;
  perform public.staff_log('content.hide', p_target_type, p_target_id::text, public.moderation_content_hide(p_target_type, p_target_id, v_reason));
end;
$fn$
  $ddl$;
  execute $ddl$
create or replace function public.admin_content_restore(p_target_type text, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_caller public.staff;
  v_before jsonb;
  v_author uuid;
  v_flag uuid;
begin
  v_caller := public.staff_require('moderator');
  if public.admin_content_table(p_target_type) is null then
    raise exception 'Invalid content type';
  end if;
  perform public.report_auto_hide_assert_reviewer(p_target_type, p_target_id, v_caller.user_id, v_caller.role);
  v_before := public.ts_snapshot(p_target_type, p_target_id);
  perform public.staff_log('content.restore', p_target_type, p_target_id::text, public.moderation_content_restore(p_target_type, p_target_id));
  v_flag := public.report_auto_hide_settle(p_target_type, p_target_id, 'restored', v_caller.user_id);
  perform public.report_auto_hide_close(p_target_type, p_target_id, 'dismissed', 'dismissed', v_caller.user_id, 'Content restored after review', 'approved');
  if v_flag is not null then
    v_author := public.ts_author_of(p_target_type, p_target_id);
    perform public.report_auto_hide_tell_owner(p_target_type, v_author, v_before, 'content_restored');
  end if;
end;
$fn$
  $ddl$;
  execute 'drop function if exists public.staff_require_area(text, text)';
end
$do$;

drop function if exists public.staff_campus_ids(uuid);
drop function if exists public.staff_content_university(text, uuid);

notify pgrst, 'reload schema';

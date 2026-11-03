-- Migration 65: what CampConnect Admin's Operations and Users sections read. Follows 20261116000000_report_auto_hide.sql;
-- rollback: supabase/rollbacks/20261117000000_console_health.down.sql.
--
-- 1. console_system_health(): one JSON document for the System health page, for staff in a session that passed
--    two-factor sign-in (ts_require_staff, migration 41). Numbers and timestamps only, never a person: the pg_cron jobs
--    and their last run (where the extension exists; null in a database without it, such as the offline suites), the
--    media worker's queue (CampConnect Admin's media_jobs, production only; null without it), the event feed sync
--    (migration 61), the daily activity snapshot (migration 63), the applied migrations (public._migrations, kept by the
--    setup script; null without it), what waits for moderation, the staff's second factors, Storage and the database size.
--    Reading cron.job_run_details needs the owner of this function to see the cron schema: on Supabase the migrations
--    run as postgres, which does.
-- 2. admin_users_list() (CampConnect Admin's migration 16, supabase/applied-outside-repo/20261103100000_admin_dashboard.sql)
--    gains the filter 'unverified': people whose email address is not confirmed or whose campus is not set, for the
--    Verification tab. Everything else in it is unchanged; it is replaced only where CampConnect Admin's schema exists.
-- Safe to run twice.

-- -----------------------------------------------------------------------------
-- 1. System health
-- -----------------------------------------------------------------------------
create or replace function public.console_system_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cron jsonb;
  v_media jsonb;
  v_migrations jsonb;
  v_staff jsonb;
  v_auto_hides int;
begin
  perform public.ts_require_staff();

  if to_regclass('cron.job') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
        'last_status', r.status, 'last_started_at', r.start_time, 'last_ended_at', r.end_time,
        'last_message', case when r.status = 'failed' then left(r.return_message, 300) else null end
      ) order by j.jobname), '[]'::jsonb)
      from cron.job j
      left join lateral (
        select d.status, d.start_time, d.end_time, d.return_message
        from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1
      ) r on true
    $q$ into v_cron;
  end if;

  if to_regclass('public.media_jobs') is not null then
    execute $q$
      select jsonb_build_object(
        'pending', count(*) filter (where done_at is null),
        'failing', count(*) filter (where done_at is null and attempts > 0 and last_error is not null),
        'done_24h', count(*) filter (where done_at >= now() - interval '24 hours'),
        'oldest_pending_at', min(created_at) filter (where done_at is null),
        'last_done_at', max(done_at),
        'last_error', (select left(m.last_error, 300) from public.media_jobs m where m.done_at is null and m.last_error is not null order by m.claimed_at desc nulls last limit 1)
      ) from public.media_jobs
    $q$ into v_media;
  end if;

  if to_regclass('public._migrations') is not null then
    execute $q$
      select jsonb_build_object('count', count(*), 'latest', max(name), 'latest_applied_at', max(applied_at)) from public._migrations
    $q$ into v_migrations;
  end if;

  if to_regclass('public.staff') is not null then
    execute $q$
      select jsonb_build_object(
        'total', count(*),
        'without_second_factor', count(*) filter (where not exists (select 1 from auth.mfa_factors f where f.user_id = s.user_id and f.status = 'verified'))
      ) from public.staff s
    $q$ into v_staff;
  end if;

  if to_regclass('public.report_auto_hides') is not null then
    execute 'select count(*) from public.report_auto_hides where status = ''pending''' into v_auto_hides;
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'cron', v_cron,
    'media', v_media,
    'feeds', (
      select jsonb_build_object(
        'enabled', count(*) filter (where f.enabled),
        'failing', count(*) filter (where f.enabled and f.last_status = 'error'),
        'last_synced_at', max(f.last_synced_at),
        'items_seen', coalesce(sum(f.items_seen), 0)
      ) from public.event_feeds f
    ),
    'activity', (
      select jsonb_build_object('latest_day', max(d.day), 'recorded_at', max(d.recorded_at),
        'dau', (select coalesce(sum(x.dau), 0) from public.platform_activity_daily x where x.day = (select max(y.day) from public.platform_activity_daily y)))
      from public.platform_activity_daily d
    ),
    'migrations', v_migrations,
    'moderation', jsonb_build_object(
      'reports_open', (select count(*) from public.reports r where r.status = 'open'),
      'oldest_open_report_at', (select min(r.created_at) from public.reports r where r.status = 'open'),
      'queue_open', (select count(*) from public.mod_queue q where q.status <> 'closed'),
      'appeals_open', (select count(*) from public.appeals a where a.status = 'open'),
      'auto_hides_pending', v_auto_hides
    ),
    'staff', v_staff,
    'storage', jsonb_build_object(
      'objects', (select count(*) from storage.objects),
      'uploads', (select count(*) from storage.objects o where o.bucket_id = 'uploads')
    ),
    'database', jsonb_build_object('size_bytes', pg_database_size(current_database()))
  );
end;
$$;
revoke all on function public.console_system_health() from public, anon;
grant execute on function public.console_system_health() to authenticated;

-- -----------------------------------------------------------------------------
-- 2. The Verification filter of the people list (only where CampConnect Admin's schema exists)
-- -----------------------------------------------------------------------------
do $do$
begin
  if to_regclass('public.staff') is null or to_regprocedure('public.staff_require(text, boolean)') is null then
    return;
  end if;
  execute $ddl$
create or replace function public.admin_users_list(p_filter text default 'all', p_limit int default 50, p_before timestamptz default null)
returns table (user_id uuid, full_name text, email text, avatar_url text, university_name text, created_at timestamptz, last_seen_at timestamptz, suspended boolean, staff_role text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_filter text := coalesce(p_filter, 'all');
begin
  perform public.staff_require('moderator');
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
    order by p.created_at desc, p.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
  $ddl$;
end
$do$;

notify pgrst, 'reload schema';

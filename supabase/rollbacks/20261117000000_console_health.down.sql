-- Rollback of 20261117000000_console_health.sql (migration 65): drops console_system_health() and, where CampConnect
-- Admin's schema exists, restores migration 16's admin_users_list() verbatim (the 'unverified' filter goes).
-- No begin/commit of its own: run it with delete from public._migrations where name = '20261117000000_console_health.sql'
-- in one transaction (supabase/CLAUDE.md).

drop function if exists public.console_system_health();

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
  if v_filter not in ('all', 'suspended', 'staff') then
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
    order by p.created_at desc, p.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
  $ddl$;
end
$do$;

notify pgrst, 'reload schema';

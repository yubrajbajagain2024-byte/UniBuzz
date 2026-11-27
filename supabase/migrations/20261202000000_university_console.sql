-- Migration 77: universities in the UniBuzz Master Admin Portal (Phase 3 of the roadmap, docs/status.md): campus
-- details, and sign-up domains opened by owners only. Follows 76 (20261201000000_campus_appointments.sql) in file order
-- but needs only 41 (Trust & Safety's console helpers), 70 (university requests: no API role writes universities) and
-- 72 (staff_role_of): it touches nothing 73 to 76 change. Rollback: supabase/rollbacks/20261202000000_university_console.down.sql.
--
-- 1. console_universities() and console_university(id) (owners and admins of the staff, second factor; ts_require_admin):
--    every university with its details, its sign-up domain, how many confirmed accounts sign in with that domain (its
--    verified students), its calendar feeds and its upcoming events.
-- 2. console_update_university(id, patch) (owners and admins): the campus details: name (unique), short name, city,
--    country, time zone (one PostgreSQL knows), latitude and longitude (both or neither). Never the sign-up domain.
-- 3. console_set_university_domain(id, domain) (owners only, as decided on 2026-11-25): opens sign-up to a domain, or
--    closes it with null. A domain is a lowercase host name; a public mail provider (gmail.com and the like) is refused,
--    as is one another university already has. Changing or closing a domain that confirmed accounts already sign in
--    with is refused: verified_university() reads the domain, so those students would silently lose their verified
--    campus (campus posts, Buzz, staff scopes); that stays a deliberate step in the SQL editor.
--    Where CampConnect Admin's staff list is missing (this repo's own schema) there are no owners and the function
--    refuses everyone; the SQL editor and the service role remain.
-- Every change is written to the staff audit log (console_audit) with what it was before. Calendar feeds keep their
-- functions (61: events_console_feed_save and _delete, admins); the portal now manages them per campus.
-- Safe to run more than once.

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
-- A university as the portal shows it. It takes the id, not the row: a function taking a table's row type depends on
-- that table, which would hold up other migrations' rollbacks (console-business.test.mjs checks no function does).
create or replace function public.console_university_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', u.id, 'name', u.name, 'shortName', u.short_name, 'city', u.city, 'country', u.country,
    'emailDomain', u.email_domain, 'timezone', u.timezone, 'latitude', u.latitude, 'longitude', u.longitude,
    'createdAt', public.ts_ms(u.created_at),
    'verifiedStudents', case when u.email_domain is null then 0 else (
      select count(*) from auth.users a
      where a.email_confirmed_at is not null and lower(split_part(a.email::text, '@', 2)) = lower(u.email_domain)) end,
    'feeds', (select count(*) from public.event_feeds f where f.university_id = u.id),
    'upcomingEvents', (select count(*) from public.events e where e.university_id = u.id and e.status = 'scheduled' and e.starts_at >= now()))
  from public.universities u where u.id = p_id;
$$;
revoke all on function public.console_university_json(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. Reading
-- -----------------------------------------------------------------------------
create or replace function public.console_universities(p_q text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  perform public.ts_require_admin();
  return coalesce((
    select jsonb_agg(public.console_university_json(u.id) order by (u.email_domain is null), u.name)
    from public.universities u
    where v_q is null or u.name ilike '%' || v_q || '%' or u.short_name ilike '%' || v_q || '%' or u.email_domain ilike '%' || v_q || '%'
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.console_universities(text) from public, anon;
grant execute on function public.console_universities(text) to authenticated;

create or replace function public.console_university(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  u public.universities;
begin
  perform public.ts_require_admin();
  select * into u from public.universities where id = p_id;
  if u.id is null then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  return public.console_university_json(u.id);
end;
$$;
revoke all on function public.console_university(uuid) from public, anon;
grant execute on function public.console_university(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Campus details
-- -----------------------------------------------------------------------------
-- p_patch: any of name, shortName, city, country, timezone, latitude, longitude (null clears an optional one).
create or replace function public.console_update_university(p_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patch jsonb := case when jsonb_typeof(p_patch) = 'object' then p_patch else '{}'::jsonb end;
  u public.universities;
  v_before jsonb;
  v_name text;
  v_short text;
  v_city text;
  v_country text;
  v_tz text;
  v_lat double precision;
  v_lng double precision;
begin
  perform public.ts_require_admin();
  select * into u from public.universities where id = p_id for update;
  if u.id is null then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  v_before := jsonb_build_object('name', u.name, 'shortName', u.short_name, 'city', u.city, 'country', u.country,
                                 'timezone', u.timezone, 'latitude', u.latitude, 'longitude', u.longitude);
  v_name := case when v_patch ? 'name' then btrim(v_patch ->> 'name') else u.name end;
  v_short := case when v_patch ? 'shortName' then nullif(btrim(coalesce(v_patch ->> 'shortName', '')), '') else u.short_name end;
  v_city := case when v_patch ? 'city' then nullif(btrim(coalesce(v_patch ->> 'city', '')), '') else u.city end;
  v_country := case when v_patch ? 'country' then nullif(btrim(coalesce(v_patch ->> 'country', '')), '') else u.country end;
  v_tz := case when v_patch ? 'timezone' then btrim(coalesce(v_patch ->> 'timezone', '')) else u.timezone end;
  if char_length(coalesce(v_name, '')) not between 2 and 120 then
    perform public.ts_fail('validation_failed', 'Give the university a name of 2 to 120 characters.');
  end if;
  if char_length(coalesce(v_short, '')) > 30 or char_length(coalesce(v_city, '')) > 120 or char_length(coalesce(v_country, '')) > 120 then
    perform public.ts_fail('validation_failed', 'Keep the short name under 30 characters and the city and country under 120.');
  end if;
  if not exists (select 1 from pg_timezone_names t where t.name = v_tz) then
    perform public.ts_fail('validation_failed', 'Pick a time zone such as America/Chicago.');
  end if;
  if v_patch ? 'latitude' or v_patch ? 'longitude' then
    begin
      v_lat := nullif(v_patch ->> 'latitude', '')::double precision;
      v_lng := nullif(v_patch ->> 'longitude', '')::double precision;
    exception when others then
      perform public.ts_fail('validation_failed', 'Latitude and longitude are numbers.');
    end;
    if (v_lat is null) <> (v_lng is null) then
      perform public.ts_fail('validation_failed', 'Give both latitude and longitude, or neither.');
    end if;
    if v_lat not between -90 and 90 or v_lng not between -180 and 180 then
      perform public.ts_fail('validation_failed', 'Latitude is between -90 and 90, longitude between -180 and 180.');
    end if;
  else
    v_lat := u.latitude;
    v_lng := u.longitude;
  end if;
  if exists (select 1 from public.universities x where lower(x.name) = lower(v_name) and x.id <> u.id) then
    perform public.ts_fail('conflict', 'Another university already has that name.');
  end if;
  update public.universities
  set name = v_name, short_name = v_short, city = v_city, country = v_country, timezone = v_tz, latitude = v_lat, longitude = v_lng
  where id = u.id
  returning * into u;
  perform public.console_audit('university.update', 'university', u.id::text, null,
    jsonb_build_object('name', u.name, 'before', v_before,
      'after', jsonb_build_object('name', u.name, 'shortName', u.short_name, 'city', u.city, 'country', u.country,
                                  'timezone', u.timezone, 'latitude', u.latitude, 'longitude', u.longitude)));
  return public.console_university_json(u.id);
end;
$$;
revoke all on function public.console_update_university(uuid, jsonb) from public, anon;
grant execute on function public.console_update_university(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Sign-up domains: owners only
-- -----------------------------------------------------------------------------
create or replace function public.console_set_university_domain(p_id uuid, p_domain text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.universities;
  v_domain text := nullif(regexp_replace(lower(btrim(coalesce(p_domain, ''))), '^@', ''), '');
  v_other text;
  v_accounts int;
  v_old text;
begin
  perform public.ts_require_admin();
  if public.staff_role_of(auth.uid()) is distinct from 'owner' then
    perform public.ts_fail('forbidden', 'Only owners open or close sign-up for a domain.');
  end if;
  select * into u from public.universities where id = p_id for update;
  if u.id is null then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  if v_domain is not null then
    if char_length(v_domain) > 253 or v_domain !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then
      perform public.ts_fail('validation_failed', 'Enter the domain students sign in with, such as txstate.edu.');
    end if;
    if v_domain = any (array['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com',
                             'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me',
                             'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'yandex.ru', 'zoho.com', 'qq.com', '163.com',
                             '126.com', 'hey.com', 'fastmail.com', 'tutanota.com', 'duck.com', 'example.com', 'example.edu']) then
      perform public.ts_fail('validation_failed', 'That is a public mail provider, not a university''s domain.');
    end if;
    select x.name into v_other from public.universities x where lower(x.email_domain) = v_domain and x.id <> u.id;
    if v_other is not null then
      perform public.ts_fail('conflict', format('%s already signs students in with that domain.', v_other));
    end if;
  end if;
  v_old := lower(u.email_domain);
  if v_domain is not distinct from v_old then
    return public.console_university_json(u.id);
  end if;
  if u.email_domain is not null then
    select count(*) into v_accounts from auth.users a
    where a.email_confirmed_at is not null and lower(split_part(a.email::text, '@', 2)) = lower(u.email_domain);
    if v_accounts > 0 then
      perform public.ts_fail('conflict', format('%s confirmed account(s) sign in with @%s: changing or closing it would take their verified campus away. That stays a deliberate step for the database owner.', v_accounts, lower(u.email_domain)));
    end if;
  end if;
  update public.universities set email_domain = v_domain where id = u.id returning * into u;
  perform public.console_audit('university.domain', 'university', u.id::text, null,
    jsonb_build_object('name', u.name, 'from', v_old, 'to', v_domain));
  return public.console_university_json(u.id);
end;
$$;
revoke all on function public.console_set_university_domain(uuid, text) from public, anon;
grant execute on function public.console_set_university_domain(uuid, text) to authenticated;

notify pgrst, 'reload schema';

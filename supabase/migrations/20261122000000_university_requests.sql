-- =============================================================================
-- Migration 70: universities are added by the UniBuzz team, from students' requests.
-- Follows 20261121000000_event_engagement.sql (69) in file order and needs only what production already has: migration
-- 41 (ts_require_admin, ts_fail, ts_ms, ts_posting_status), 39 (is_business_account) and 63 (console_audit). Rollback:
-- supabase/rollbacks/20261122000000_university_requests.down.sql. Safe to run more than once.
--
-- The universities table decides who may sign up: universities.email_domain is what university_for_email() reads in
-- the before-insert trigger on auth.users, and verified_university() decides campus audiences from it. So only the
-- database owner, the service role and the staff functions below write it from now on.
--
--   1. universities: anon and authenticated keep SELECT (every app reads the list) and lose every other privilege;
--      migration 1's universities_insert policy is dropped. A student no longer adds a university directly.
--   2. university_requests: a student asks for a university that is missing (its name, city and country, and an
--      optional note). Closed to the API (row-level security on, no policies, no grants). Written by
--      request_university(); read by my_university_requests(), which returns the caller's own requests only. Limits:
--      signed in, email confirmed, not a business account, not suspended or muted everywhere; at most 3 pending and 5 in
--      a day; refused when the name is already listed or the caller already asked for it. A request is deleted with its
--      student's account.
--   3. The UniBuzz team reviews them in the staff app: console_university_requests() and
--      console_decide_university_request(), for owners and admins of the staff in a session that passed two-factor
--      sign-in (ts_require_admin, migration 41; moderators and everyone else get 'not found'). Approving adds the
--      university WITHOUT an email domain: opening sign-up to a domain is a separate step, for owners only. Linking
--      points the request at a university already listed. Either one closes the other pending requests for the same
--      name, linked to the same university. Every decision, and every university added, writes the staff audit log
--      (console_audit, migration 63), with the reply the student reads.
--
-- Errors: 'ts:<code>:<message>' (migration 41's codes). Times in JSON are epoch milliseconds; JSON keys are camelCase.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The universities table: read by everyone, written by no API role
-- -----------------------------------------------------------------------------
drop policy if exists "universities_insert" on public.universities;
revoke all on public.universities from public, anon, authenticated;
grant select on public.universities to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Requests
-- -----------------------------------------------------------------------------
create table if not exists public.university_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 3 and 160),
  city text check (city is null or char_length(city) <= 120),
  country text check (country is null or char_length(country) <= 120),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  university_id uuid references public.universities (id) on delete set null,
  -- What the student reads about the decision (optional).
  response text check (response is null or char_length(response) <= 1000),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint university_requests_decision check ((status = 'pending') = (decided_at is null))
);
create index if not exists university_requests_status_idx on public.university_requests (status, created_at);
create index if not exists university_requests_requester_idx on public.university_requests (requested_by, created_at desc);
create index if not exists university_requests_pending_name_idx on public.university_requests (lower(name)) where status = 'pending';

alter table public.university_requests enable row level security;
revoke all on public.university_requests from public, anon, authenticated;

-- One line of text from a form: control characters out, runs of spaces folded, trimmed; empty becomes null.
create or replace function public.university_request_text(p text)
returns text
language sql
immutable
as $$
  select nullif(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), '');
$$;
revoke all on function public.university_request_text(text) from public, anon, authenticated;

-- A request as JSON. The student's own view leaves out who asked and who decided; staff see both.
create or replace function public.university_request_json(r public.university_requests, p_staff boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'city', r.city,
    'country', r.country,
    'note', r.note,
    'status', r.status,
    'universityId', r.university_id,
    'universityName', (select u.name from public.universities u where u.id = r.university_id),
    'response', r.response,
    'createdAt', public.ts_ms(r.created_at),
    'decidedAt', public.ts_ms(r.decided_at)
  ) || case when p_staff then jsonb_build_object(
    'requester', (select jsonb_build_object('id', p.id, 'name', p.full_name, 'username', p.username) from public.profiles p where p.id = r.requested_by),
    'decidedBy', (select jsonb_build_object('id', p.id, 'name', p.full_name) from public.profiles p where p.id = r.decided_by),
    -- Other students waiting for the same name: approving or linking this one answers them too.
    'samePending', (select count(*) from public.university_requests o where o.status = 'pending' and o.id <> r.id and lower(o.name) = lower(r.name)),
    -- Universities already listed whose names contain this one's, or the other way round: perhaps it is there already.
    'similar', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'city', u.city, 'country', u.country) order by u.name)
      from (
        select u.* from public.universities u
        where strpos(lower(u.name), lower(r.name)) > 0 or strpos(lower(r.name), lower(u.name)) > 0
        order by u.name
        limit 5
      ) u
    ), '[]'::jsonb)
  ) else '{}'::jsonb end;
$$;
revoke all on function public.university_request_json(public.university_requests, boolean) from public, anon, authenticated;

-- A student asks for a university that is missing from the list.
create or replace function public.request_university(p_name text, p_city text default null, p_country text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_name text := public.university_request_text(p_name);
  v_city text := public.university_request_text(p_city);
  v_country text := public.university_request_text(p_country);
  v_note text := public.university_request_text(p_note);
  v_row public.university_requests;
begin
  if v_me is null then
    perform public.ts_fail('unauthenticated', 'Log in first.');
  end if;
  if not exists (select 1 from auth.users u where u.id = v_me and u.email_confirmed_at is not null) then
    perform public.ts_fail('forbidden', 'Confirm your email address first.');
  end if;
  if public.is_business_account(v_me) then
    perform public.ts_fail('forbidden', 'Business accounts cannot request universities.');
  end if;
  -- CampConnect Admin's suspensions (migration 15, production) and the Trust & Safety sanctions (migration 41). Nested
  -- so plpgsql resolves is_suspended only where it exists.
  if to_regprocedure('public.is_suspended(uuid)') is not null then
    if public.is_suspended(v_me) then
      perform public.ts_fail('forbidden', 'Your account is suspended.');
    end if;
  end if;
  if coalesce((public.ts_posting_status(v_me, 'university_request') ->> 'allowed')::boolean, false) is not true then
    perform public.ts_fail('forbidden', 'Your account cannot send requests right now.');
  end if;

  if v_name is null or char_length(v_name) < 3 then
    perform public.ts_fail('validation_failed', 'Enter the university name.');
  end if;
  if char_length(v_name) > 160 or char_length(coalesce(v_city, '')) > 120 or char_length(coalesce(v_country, '')) > 120 then
    perform public.ts_fail('validation_failed', 'That is too long.');
  end if;
  if char_length(coalesce(v_note, '')) > 500 then
    perform public.ts_fail('validation_failed', 'Keep the note under 500 characters.');
  end if;

  -- One student's requests are counted and written one at a time.
  perform pg_advisory_xact_lock(hashtextextended('university_request:' || v_me::text, 0));

  if exists (select 1 from public.universities u where lower(u.name) = lower(v_name)) then
    perform public.ts_fail('conflict', 'That university is already in the list.');
  end if;
  if exists (select 1 from public.university_requests r where r.requested_by = v_me and r.status = 'pending' and lower(r.name) = lower(v_name)) then
    perform public.ts_fail('conflict', 'You already asked for this university. The UniBuzz team will review it.');
  end if;
  if (select count(*) from public.university_requests r where r.requested_by = v_me and r.status = 'pending') >= 3 then
    perform public.ts_fail('rate_limited', 'You have 3 requests waiting for review. Try again once they are answered.');
  end if;
  if (select count(*) from public.university_requests r where r.requested_by = v_me and r.created_at > now() - interval '1 day') >= 5 then
    perform public.ts_fail('rate_limited', 'You have sent 5 requests today. Try again tomorrow.');
  end if;

  insert into public.university_requests (requested_by, name, city, country, note)
  values (v_me, v_name, v_city, v_country, v_note)
  returning * into v_row;
  return public.university_request_json(v_row, false);
end;
$$;
revoke all on function public.request_university(text, text, text, text) from public, anon;
grant execute on function public.request_university(text, text, text, text) to authenticated;

-- The caller's own requests, newest first (the last 20).
create or replace function public.my_university_requests()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(public.university_request_json(r, false) order by r.created_at desc), '[]'::jsonb)
  from public.university_requests r
  where r.id in (
    select x.id from public.university_requests x
    where x.requested_by = auth.uid()
    order by x.created_at desc
    limit 20
  );
$$;
revoke all on function public.my_university_requests() from public, anon;
grant execute on function public.my_university_requests() to authenticated;

-- -----------------------------------------------------------------------------
-- 3. The UniBuzz team's review (owners and admins of the staff, two-factor session)
-- -----------------------------------------------------------------------------
-- A page of requests in one status (pending: oldest first, so nobody waits longest; decided: newest first), and the
-- count in each status.
create or replace function public.console_university_requests(p_status text default 'pending', p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text := coalesce(p_status, 'pending');
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_items jsonb;
  v_total int;
begin
  perform public.ts_require_admin();
  if v_status not in ('pending', 'approved', 'declined') then
    perform public.ts_fail('validation_failed', 'Unknown status.');
  end if;
  select count(*) into v_total from public.university_requests r where r.status = v_status;
  select coalesce(jsonb_agg(public.university_request_json(q, true) order by s.o), '[]'::jsonb) into v_items
  from (
    select r.id, row_number() over (
      order by case when v_status = 'pending' then r.created_at end asc, coalesce(r.decided_at, r.created_at) desc, r.id
    ) as o
    from public.university_requests r
    where r.status = v_status
    order by o
    limit v_limit offset v_offset
  ) s
  join public.university_requests q on q.id = s.id;
  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'nextOffset', case when v_offset + v_limit < v_total then v_offset + v_limit end,
    'counts', jsonb_build_object(
      'pending', (select count(*) from public.university_requests where status = 'pending'),
      'approved', (select count(*) from public.university_requests where status = 'approved'),
      'declined', (select count(*) from public.university_requests where status = 'declined')
    )
  );
end;
$$;
revoke all on function public.console_university_requests(text, int, int) from public, anon;
grant execute on function public.console_university_requests(text, int, int) to authenticated;

-- Decide one request: 'approve' adds the university (the name, city and country may be corrected first), 'link' points
-- the request at a university already listed (p_university), 'decline' closes it. p_response is what the student reads.
-- Approving and linking also answer every other pending request for the same name.
create or replace function public.console_decide_university_request(
  p_id uuid, p_decision text, p_name text default null, p_city text default null, p_country text default null,
  p_university uuid default null, p_response text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_row public.university_requests;
  v_decision text := coalesce(p_decision, '');
  v_response text := public.university_request_text(p_response);
  v_name text;
  v_city text;
  v_country text;
  v_university uuid;
  v_created boolean := false;
  v_also int := 0;
begin
  perform public.ts_require_admin();
  if v_decision not in ('approve', 'link', 'decline') then
    perform public.ts_fail('validation_failed', 'Choose approve, link or decline.');
  end if;
  if char_length(coalesce(v_response, '')) > 1000 then
    perform public.ts_fail('validation_failed', 'Keep the reply under 1,000 characters.');
  end if;

  select * into v_row from public.university_requests r where r.id = p_id for update;
  if v_row.id is null then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  if v_row.status <> 'pending' then
    perform public.ts_fail('conflict', 'This request was already decided.');
  end if;

  if v_decision = 'approve' then
    v_name := coalesce(public.university_request_text(p_name), v_row.name);
    v_city := case when p_city is null then v_row.city else public.university_request_text(p_city) end;
    v_country := case when p_country is null then v_row.country else public.university_request_text(p_country) end;
    if char_length(v_name) < 3 or char_length(v_name) > 160 or char_length(coalesce(v_city, '')) > 120 or char_length(coalesce(v_country, '')) > 120 then
      perform public.ts_fail('validation_failed', 'Check the name, city and country.');
    end if;
    if exists (select 1 from public.universities u where lower(u.name) = lower(v_name)) then
      perform public.ts_fail('conflict', 'A university with that name is already listed. Link the request to it instead.');
    end if;
    -- Never an email domain here: opening sign-up to a domain is the owners' separate step.
    insert into public.universities (name, city, country) values (v_name, v_city, v_country) returning id into v_university;
    v_created := true;
    perform public.console_audit('university.create', 'university', v_university::text, null,
      jsonb_build_object('name', v_name, 'city', v_city, 'country', v_country, 'requestId', v_row.id));
  elsif v_decision = 'link' then
    select u.id into v_university from public.universities u where u.id = p_university;
    if v_university is null then
      perform public.ts_fail('validation_failed', 'Choose the university to link the request to.');
    end if;
  end if;

  update public.university_requests
  set status = case when v_decision = 'decline' then 'declined' else 'approved' end,
      university_id = v_university,
      response = v_response,
      decided_by = v_me,
      decided_at = now()
  where id = v_row.id
  returning * into v_row;

  if v_university is not null then
    update public.university_requests o
    set status = 'approved', university_id = v_university, decided_by = v_me, decided_at = now()
    where o.status = 'pending' and o.id <> v_row.id and lower(o.name) = lower(v_row.name);
    get diagnostics v_also = row_count;
  end if;

  perform public.console_audit('university_request.' || v_decision, 'university_request', v_row.id::text, v_response,
    jsonb_build_object('name', v_row.name, 'universityId', v_university, 'created', v_created, 'alsoAnswered', v_also));
  return public.university_request_json(v_row, true);
end;
$$;
revoke all on function public.console_decide_university_request(uuid, text, text, text, text, uuid, text) from public, anon;
grant execute on function public.console_decide_university_request(uuid, text, text, text, text, uuid, text) to authenticated;

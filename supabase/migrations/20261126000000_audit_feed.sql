-- Migration 71: one audit view for the UniBuzz Master Admin Portal (apps/admin), and where each staff action came from.
-- Follows 70 (20261122000000_university_requests.sql); Phase 1 of the portal's roadmap (docs/status.md). Rollback:
-- supabase/rollbacks/20261126000000_audit_feed.down.sql (it keeps the context already recorded).
--
-- The platform writes three append-only logs: staff_audit_log (the team, security and the admin app's moderation;
-- CampConnect Admin's migration 14, on production and staging only), audit_log (Trust & Safety, migration 41) and
-- business_audit_log (Business v2, migration 47). Each has its own reader and its own rules for moderators.
--
-- 1. audit_request_context: for a log row whose actor is a member of the staff acting in their own API request, where
--    that request came from: the address and browser the API gateway saw, the address, browser and page the portal's
--    server reports for the staff member's browser (its x-portal-* headers: claims, since anyone calling the API could
--    send them, so they are kept apart from the gateway's), the API endpoint, the session id and its assurance level.
--    Never for students, business teams or the system: a student's appeal is logged with a null actor during the
--    student's own request, a business's own changes with actor_kind 'team'; neither gets context. Closed to the API,
--    and kept apart from the logs so that a retention limit can delete old addresses later without touching their
--    append-only rows. No foreign keys, like the logs: an entry outlives the person.
-- 2. After-insert triggers on the three logs fill it, best effort: a failure never blocks the action being audited.
-- 3. console_audit_feed(p_filters, p_limit): the three logs merged newest first, 50 at a time, with a keyset cursor
--    (no offsets, so a page stays cheap however long the logs grow). Each log keeps its reader's rules: moderators see in
--    staff_audit_log their own rows and moderation activity, a deleted Buzz thread's snapshot without its author
--    (admin_audit_list, migration 14); in audit_log their own rows, never a user target tied to an anonymous Buzz item,
--    identities stripped by ts_audit_row_json (console_audit, migration 41); nothing of business_audit_log (an owners'
--    and admins' section). Owners and admins see everything, and the request context. Staff with a second factor only
--    (ts_require_staff).
-- 4. Indexes for the merge: staff_audit_log and business_audit_log by (created_at desc, id desc), as audit_log has.
--
-- Safe to run more than once. Works with and without CampConnect Admin's schema (public.staff, staff_audit_log): the
-- optional table is reached with dynamic SQL only where it exists.

-- -----------------------------------------------------------------------------
-- 1. Where staff actions came from
-- -----------------------------------------------------------------------------
create table if not exists public.audit_request_context (
  log text not null check (log in ('staff', 'trust_safety', 'business')),
  entry_id text not null,
  actor_id uuid not null,
  gateway_ip text,
  user_agent text,
  portal_ip text,
  portal_user_agent text,
  portal_path text,
  endpoint text,
  session_id uuid,
  aal text,
  created_at timestamptz not null default clock_timestamp(),
  primary key (log, entry_id)
);
create index if not exists audit_request_context_actor_idx on public.audit_request_context (actor_id, created_at desc);
alter table public.audit_request_context enable row level security;
revoke all on table public.audit_request_context from public, anon, authenticated;

-- A header's value made safe to keep: no control characters, trimmed, at most p_max characters, null when empty.
create or replace function public.audit_context_text(p_value text, p_max int)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(left(btrim(regexp_replace(coalesce(p_value, ''), '[[:cntrl:]]', '', 'g')), p_max), '')
$$;
revoke all on function public.audit_context_text(text, int) from public, anon, authenticated;

-- Whether p_user is on the staff list (CampConnect Admin's public.staff where it exists, else migration 41's
-- staff_members). Suspended staff count: what they did while suspended is exactly what an investigation needs.
create or replace function public.audit_actor_is_staff(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_found boolean := false;
begin
  if p_user is null then
    return false;
  end if;
  if to_regclass('public.staff') is not null then
    execute 'select exists (select 1 from public.staff s where s.user_id = $1)' into v_found using p_user;
    if v_found then
      return true;
    end if;
  end if;
  if to_regclass('public.staff_members') is not null then
    execute 'select exists (select 1 from public.staff_members s where s.user_id = $1)' into v_found using p_user;
  end if;
  return coalesce(v_found, false);
end;
$$;
revoke all on function public.audit_actor_is_staff(uuid) from public, anon, authenticated;

-- The trigger behind every log (TG_ARGV[0]: 'staff', 'trust_safety' or 'business'). Context only when the row's actor
-- is a member of the staff, the request is their own (auth.uid()), and the request came through the API (PostgREST's
-- request.headers). An IP is kept only if it is made of an address's characters.
create or replace function public.audit_capture_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_actor uuid;
  v_headers jsonb;
  v_claims jsonb;
  v_portal_ip text;
  v_gateway_ip text;
  v_session text;
begin
  begin
    if tg_argv[0] = 'business' and (v_row ->> 'actor_kind') is distinct from 'admin' then
      return null;
    end if;
    v_actor := nullif(v_row ->> 'actor_id', '')::uuid;
    if v_actor is null or v_actor is distinct from auth.uid() or not public.audit_actor_is_staff(v_actor) then
      return null;
    end if;
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    if v_headers is null or jsonb_typeof(v_headers) <> 'object' then
      return null;
    end if;
    v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
    v_gateway_ip := public.audit_context_text(v_headers ->> 'x-forwarded-for', 200);
    if v_gateway_ip !~ '^[0-9A-Fa-f:., ]+$' then
      v_gateway_ip := null;
    end if;
    v_portal_ip := public.audit_context_text(v_headers ->> 'x-portal-client-ip', 45);
    if v_portal_ip !~ '^[0-9A-Fa-f:.]+$' then
      v_portal_ip := null;
    end if;
    v_session := v_claims ->> 'session_id';
    insert into public.audit_request_context (log, entry_id, actor_id, gateway_ip, user_agent, portal_ip, portal_user_agent, portal_path, endpoint, session_id, aal)
    values (
      tg_argv[0], v_row ->> 'id', v_actor, v_gateway_ip,
      public.audit_context_text(v_headers ->> 'user-agent', 300),
      v_portal_ip,
      public.audit_context_text(v_headers ->> 'x-portal-user-agent', 300),
      public.audit_context_text(v_headers ->> 'x-portal-path', 200),
      public.audit_context_text(current_setting('request.path', true), 200),
      case when v_session ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_session::uuid end,
      public.audit_context_text(v_claims ->> 'aal', 10)
    )
    on conflict (log, entry_id) do nothing;
  exception when others then
    -- Context is a help for investigations, never a condition of the action itself.
    null;
  end;
  return null;
end;
$$;
revoke all on function public.audit_capture_context() from public, anon, authenticated;

drop trigger if exists audit_log_request_context on public.audit_log;
create trigger audit_log_request_context after insert on public.audit_log
  for each row execute function public.audit_capture_context('trust_safety');
drop trigger if exists business_audit_log_request_context on public.business_audit_log;
create trigger business_audit_log_request_context after insert on public.business_audit_log
  for each row execute function public.audit_capture_context('business');

do $$
begin
  if to_regclass('public.staff_audit_log') is not null then
    execute 'drop trigger if exists staff_audit_log_request_context on public.staff_audit_log';
    execute 'create trigger staff_audit_log_request_context after insert on public.staff_audit_log
               for each row execute function public.audit_capture_context(''staff'')';
    execute 'create index if not exists staff_audit_log_created_idx on public.staff_audit_log (created_at desc, id desc)';
  end if;
end;
$$;
create index if not exists business_audit_log_created_idx on public.business_audit_log (created_at desc, id desc);

-- -----------------------------------------------------------------------------
-- 2. The feed
-- -----------------------------------------------------------------------------
-- A row's request context for the feed, or null.
create or replace function public.audit_context_json(p_log text, p_entry text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'gatewayIp', c.gateway_ip, 'userAgent', c.user_agent, 'portalIp', c.portal_ip, 'portalUserAgent', c.portal_user_agent,
    'portalPath', c.portal_path, 'endpoint', c.endpoint, 'sessionId', c.session_id, 'aal', c.aal)
  from public.audit_request_context c
  where c.log = p_log and c.entry_id = p_entry
$$;
revoke all on function public.audit_context_json(text, text) from public, anon, authenticated;

-- Filters (all optional): source ('staff', 'trust_safety', 'business'), actor (a user id), action (exact, or a prefix
-- when it ends with '.'), targetType, targetId, business (a business id: its rows only), from and to (ms since the
-- epoch), before (the nextCursor of the previous page). Items newest first, each with its source and cursor.
create or replace function public.console_audit_feed(p_filters jsonb default '{}'::jsonb, p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_staff();
  v_admin boolean := v_role = 'admin';
  v_me uuid := auth.uid();
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_f jsonb := case when jsonb_typeof(p_filters) = 'object' then p_filters else '{}'::jsonb end;
  v_source text := case when v_f ->> 'source' in ('staff', 'trust_safety', 'business') then v_f ->> 'source' end;
  v_actor uuid := public.ts_uuid(v_f ->> 'actor');
  v_action text := nullif(left(btrim(coalesce(v_f ->> 'action', '')), 80), '');
  v_prefix boolean;
  v_target_type text := nullif(left(btrim(coalesce(v_f ->> 'targetType', '')), 40), '');
  v_target_id text := nullif(left(btrim(coalesce(v_f ->> 'targetId', '')), 80), '');
  v_business uuid := public.ts_uuid(v_f ->> 'business');
  v_from timestamptz := public.ts_from_ms(case when (v_f ->> 'from') ~ '^\d{1,15}$' then (v_f ->> 'from')::bigint end);
  v_to timestamptz := public.ts_from_ms(case when (v_f ->> 'to') ~ '^\d{1,15}$' then (v_f ->> 'to')::bigint end);
  v_cursor text[] := regexp_match(coalesce(v_f ->> 'before', ''), '^(\d{1,19})-([123])-(\d{1,19})$');
  v_c_at timestamptz;
  v_c_rank int;
  v_c_ord bigint;
  v_staff jsonb := '[]'::jsonb;
  v_ts jsonb := '[]'::jsonb;
  v_biz jsonb := '[]'::jsonb;
  v_items jsonb;
  v_count int;
begin
  if v_action is not null then
    v_prefix := right(v_action, 1) = '.';
  end if;
  if v_cursor is not null then
    v_c_at := 'epoch'::timestamptz + (v_cursor[1] || ' microseconds')::interval;
    v_c_rank := v_cursor[2]::int;
    v_c_ord := v_cursor[3]::bigint;
  end if;

  -- The team, security and the admin app's moderation (rank 3), where CampConnect Admin's schema exists.
  if to_regclass('public.staff_audit_log') is not null and (v_source is null or v_source = 'staff') and v_business is null then
    execute $q$
      select coalesce(jsonb_agg(x.item order by x.created_at desc, x.id desc), '[]'::jsonb)
      from (
        select l.created_at, l.id, jsonb_build_object(
          'source', 'staff',
          'id', l.id::text,
          'cursor', (extract(epoch from l.created_at) * 1000000)::bigint::text || '-3-' || l.id::text,
          'createdAt', l.created_at,
          'actor', case when l.actor_id is null and l.actor_email is null then null
                        else jsonb_build_object('id', l.actor_id, 'name', p.full_name, 'email', l.actor_email) end,
          'action', l.action,
          'targetType', l.target_type,
          'targetId', l.target_id,
          'reason', null,
          -- A deleted Buzz thread's record names its author; moderators see the text, not the identity (migration 14).
          'details', case when not $1 and l.action = 'content.delete' and l.target_type in ('buzz', 'buzz_comment')
                            then (l.details - 'children') || jsonb_build_object('snapshot', coalesce(l.details -> 'snapshot', '{}'::jsonb) - 'author_id' - 'author_name' - 'author_email')
                          else l.details end,
          'business', null,
          'context', case when $1 then public.audit_context_json('staff', l.id::text) end) as item
        from public.staff_audit_log l
        left join public.profiles p on p.id = l.actor_id
        where ($1 or l.actor_id = $2 or l.action like 'content.%' or l.action like 'report.%' or l.action like 'user.%' or l.action like 'media.%')
          and ($3::uuid is null or l.actor_id = $3)
          and ($4::text is null or (case when $5 then left(l.action, length($4)) = $4 else l.action = $4 end))
          and ($6::text is null or l.target_type = $6)
          and ($7::text is null or l.target_id = $7)
          and ($8::timestamptz is null or l.created_at >= $8)
          and ($9::timestamptz is null or l.created_at <= $9)
          and ($10::timestamptz is null or l.created_at < $10 or (l.created_at = $10 and (3 < $11 or (3 = $11 and l.id < $12))))
        order by l.created_at desc, l.id desc
        limit $13
      ) x
    $q$
    into v_staff
    using v_admin, v_me, v_actor, v_action, coalesce(v_prefix, false), v_target_type, v_target_id, v_from, v_to, v_c_at, v_c_rank, v_c_ord, v_limit + 1;
  end if;

  -- Trust & Safety (rank 2): moderators read their own rows only, never a user target tied to an anonymous Buzz item.
  if (v_source is null or v_source = 'trust_safety') and v_business is null then
    select coalesce(jsonb_agg(x.item order by x.created_at desc, x.seq desc), '[]'::jsonb)
    into v_ts
    from (
      select a.created_at, a.seq, (j || jsonb_build_object(
        'source', 'trust_safety',
        'id', a.id::text,
        'cursor', (extract(epoch from a.created_at) * 1000000)::bigint::text || '-2-' || a.seq::text,
        'createdAt', a.created_at,
        'actor', case when j -> 'actor' is null or jsonb_typeof(j -> 'actor') = 'null' then null
                      else jsonb_build_object('id', j -> 'actor' -> 'id', 'name', j -> 'actor' ->> 'displayName', 'email', null, 'role', j -> 'actor' ->> 'role') end,
        'details', coalesce(j -> 'metadata', '{}'::jsonb),
        'business', null,
        'context', case when v_admin then public.audit_context_json('trust_safety', a.id::text) end)) - 'metadata' as item
      from public.audit_log a
      cross join lateral (select public.ts_audit_row_json(a, v_admin) as j) r
      where (v_admin or a.actor_id = v_me)
        and (v_admin or not (a.target_type = 'user' and public.ts_is_anon((select q.entity_type from public.mod_queue q where q.id = a.queue_id))))
        and (v_actor is null or a.actor_id = v_actor)
        and (v_action is null or (case when v_prefix then left(a.action, length(v_action)) = v_action else a.action = v_action end))
        and (v_target_type is null or a.target_type = v_target_type)
        and (v_target_id is null or a.target_id = v_target_id)
        and (v_from is null or a.created_at >= v_from)
        and (v_to is null or a.created_at <= v_to)
        and (v_c_at is null or a.created_at < v_c_at or (a.created_at = v_c_at and (2 < v_c_rank or (2 = v_c_rank and a.seq < v_c_ord))))
      order by a.created_at desc, a.seq desc
      limit v_limit + 1
    ) x;
  end if;

  -- Businesses (rank 1): owners and admins only, as the portal's Business section.
  if v_admin and (v_source is null or v_source = 'business') then
    select coalesce(jsonb_agg(x.item order by x.created_at desc, x.id desc), '[]'::jsonb)
    into v_biz
    from (
      select l.created_at, l.id, jsonb_build_object(
        'source', 'business',
        'id', l.id::text,
        'cursor', (extract(epoch from l.created_at) * 1000000)::bigint::text || '-1-' || l.id::text,
        'createdAt', l.created_at,
        'actor', case when l.actor_kind = 'system' or l.actor_id is null then null
                      else jsonb_build_object('id', l.actor_id, 'name', coalesce(p.full_name, case when l.actor_kind = 'admin' then 'UniBuzz team' else 'Former member' end),
                                              'email', null, 'kind', l.actor_kind) end,
        'action', l.action,
        'targetType', l.target_type,
        'targetId', l.target_id::text,
        'reason', null,
        'details', l.detail,
        'business', case when l.business_id is null then null
                         else jsonb_build_object('id', l.business_id, 'name', coalesce(b.name, l.detail ->> 'business_name')) end,
        'context', public.audit_context_json('business', l.id::text)) as item
      from public.business_audit_log l
      left join public.businesses b on b.id = l.business_id
      left join public.profiles p on p.id = l.actor_id
      where (v_business is null or l.business_id = v_business)
        and (v_actor is null or l.actor_id = v_actor)
        and (v_action is null or (case when v_prefix then left(l.action, length(v_action)) = v_action else l.action = v_action end))
        and (v_target_type is null or l.target_type = v_target_type)
        and (v_target_id is null or l.target_id::text = v_target_id)
        and (v_from is null or l.created_at >= v_from)
        and (v_to is null or l.created_at <= v_to)
        and (v_c_at is null or l.created_at < v_c_at or (l.created_at = v_c_at and (1 < v_c_rank or (1 = v_c_rank and l.id < v_c_ord))))
      order by l.created_at desc, l.id desc
      limit v_limit + 1
    ) x;
  end if;

  -- Merge: newest first; at the same instant the team's log, then Trust & Safety, then businesses; then by id.
  select coalesce(jsonb_agg(m.item order by m.at desc, m.rank desc, m.ord desc), '[]'::jsonb), count(*)
  into v_items, v_count
  from (
    select e.item,
           split_part(e.item ->> 'cursor', '-', 1)::bigint as at,
           split_part(e.item ->> 'cursor', '-', 2)::int as rank,
           split_part(e.item ->> 'cursor', '-', 3)::bigint as ord
    from jsonb_array_elements(v_staff || v_ts || v_biz) e(item)
    order by 2 desc, 3 desc, 4 desc
    limit v_limit + 1
  ) m;
  if v_count > v_limit then
    v_items := v_items - v_limit;
  end if;
  return jsonb_build_object(
    'items', v_items,
    'nextCursor', case when v_count > v_limit then v_items -> (v_limit - 1) ->> 'cursor' end,
    'sources', to_jsonb(array_remove(array[
      case when to_regclass('public.staff_audit_log') is not null then 'staff' end,
      'trust_safety',
      case when v_admin then 'business' end], null)),
    'contextVisible', v_admin);
end;
$$;
revoke all on function public.console_audit_feed(jsonb, int) from public, anon;
grant execute on function public.console_audit_feed(jsonb, int) to authenticated;

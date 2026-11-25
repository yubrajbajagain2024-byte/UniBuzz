-- =============================================================================
-- UniBuzz - migration 69: likes, comments and who is going, on events
-- Follows 20261120000000_story_self_like.sql (migration 68) in file order, and needs nothing of it: it builds on 61
-- (events, events_read), the engagement tables (post_likes, post_comments: 13, 20, 22, 44) and 9 (blocks), all live.
-- Rollback: supabase/rollbacks/20261121000000_event_engagement.down.sql. Safe to run more than once.
--
-- The owner's brief (2026-11-25): like, comment, share, save and RSVP on every event card and page, and who is going
-- seen by everyone who can see the event (the owner's choice over "friends by name" and "a count only").
--
--  1. post_likes and post_comments take target_type 'event', so an event is liked and commented on as a post is, with
--     the same counts (post_engagement, post_engagement_many), threads, comment hearts and moderation guards.
--  2. Only on an event the caller can see: a like or a comment is refused on an event events_read hides from them
--     (pending, hidden, an inactive organization's), and comments on an event are read only by those who can see it
--     (and by their writers, who can still find and delete them), restrictive as 44's post audience policy is.
--     Where CampConnect Admin's moderation is installed (production, staging), its target_visible() learns 'event' too,
--     or its insert policies would refuse every like and comment on an event.
--  3. post_link knows events, so a reply to a comment on an event links to /events/<id> (its notification, and the
--     console's snapshot of a reported comment).
--  4. Nobody is notified of a like or a comment on an event itself: listing_owner and listing_poster have no 'event'
--     case, so an event has no owner to tell (a campus calendar's events have none at all). Deleting a comment there
--     stays its writer's (and staff's), and a block still keeps two people out of each other's threads (13, 20).
--  5. event_rsvps: who is going. One row per student and event; a student adds and removes only their own, on an event
--     they can see, from the student side; it is read by everyone signed in who can see the event, less anyone blocked
--     either way. Nothing for the signed-out.
--  6. event_going_many(ids): how many are going and whether you are, for a page of events, under those same rules.
-- =============================================================================

-- 1. ------------------------------------------------------------------------
alter table public.post_likes drop constraint if exists post_likes_target_type_check;
alter table public.post_likes add constraint post_likes_target_type_check check (target_type in ('apartment', 'item', 'roommate', 'post', 'event'));
alter table public.post_comments drop constraint if exists post_comments_target_type_check;
alter table public.post_comments add constraint post_comments_target_type_check check (target_type in ('apartment', 'item', 'roommate', 'post', 'event'));

-- 2. ------------------------------------------------------------------------
-- Security invoker on purpose: the event is looked up through events_read, so what the caller may not see is not there.
-- Without a caller (the service role, the SQL editor) nothing is checked.
create or replace function public.event_engagement_check()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.target_type = 'event' and (select auth.uid()) is not null
     and not exists (select 1 from public.events e where e.id = new.target_id) then
    raise exception 'This event is not available.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.event_engagement_check() from public, anon, authenticated;

drop trigger if exists post_likes_event_check on public.post_likes;
create trigger post_likes_event_check
  before insert on public.post_likes
  for each row execute function public.event_engagement_check();
drop trigger if exists post_comments_event_check on public.post_comments;
create trigger post_comments_event_check
  before insert on public.post_comments
  for each row execute function public.event_engagement_check();

drop policy if exists "post_comments_event_audience" on public.post_comments;
create policy "post_comments_event_audience" on public.post_comments
  as restrictive for select
  using (target_type <> 'event' or user_id = (select auth.uid()) or exists (select 1 from public.events e where e.id = target_id));

-- 2b. -----------------------------------------------------------------------
-- CampConnect Admin's moderation (supabase/applied-outside-repo/20261024000000_moderation_support.sql, on production and
-- staging) adds target_visible() to the insert policies of likes and comments, and it answers false for a type it does
-- not know: there, it takes the 'event' case too (an event staff have not hidden; what a student may see is the trigger's
-- to decide, above). Every other case is that file's, word for word. Without that schema there is nothing to change.
do $do$
begin
  if to_regprocedure('public.target_visible(text, uuid)') is not null then
    execute $f$
      create or replace function public.target_visible(p_type text, p_id uuid)
      returns boolean
      language sql
      stable
      security definer
      set search_path = public
      as $$
        select case p_type
          when 'apartment' then exists (select 1 from public.apartments a where a.id = p_id and public.content_visible(a.owner_id, a.hidden_at))
          when 'item' then exists (select 1 from public.items i where i.id = p_id and public.content_visible(i.seller_id, i.hidden_at))
          when 'roommate' then exists (select 1 from public.roommate_posts r where r.id = p_id and public.content_visible(r.author_id, r.hidden_at))
          when 'post' then exists (select 1 from public.feed_posts f where f.id = p_id and public.content_visible(f.author_id, f.hidden_at))
          when 'event' then exists (select 1 from public.events e where e.id = p_id and e.status <> 'hidden')
          else false
        end;
      $$
    $f$;
  end if;
end
$do$;

-- 3. ------------------------------------------------------------------------
-- Migration 20's function with the 'event' case; every other link is as it was.
create or replace function public.post_link(p_target_type text, p_target_id uuid)
returns text
language sql
immutable
as $$
  select case p_target_type
    when 'apartment' then '/apartments/'
    when 'item' then '/marketplace/'
    when 'post' then '/posts/'
    when 'event' then '/events/'
    else '/roommates/'
  end || p_target_id;
$$;

-- 5. ------------------------------------------------------------------------
create table if not exists public.event_rsvps (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists event_rsvps_user_idx on public.event_rsvps (user_id);
alter table public.event_rsvps enable row level security;

drop policy if exists "event_rsvps_read" on public.event_rsvps;
create policy "event_rsvps_read" on public.event_rsvps for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id) and not public.is_blocked_either_way(user_id));
drop policy if exists "event_rsvps_insert_own" on public.event_rsvps;
create policy "event_rsvps_insert_own" on public.event_rsvps for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.student_side_ok()) and exists (select 1 from public.events e where e.id = event_id));
drop policy if exists "event_rsvps_delete_own" on public.event_rsvps;
create policy "event_rsvps_delete_own" on public.event_rsvps for delete to authenticated
  using (user_id = (select auth.uid()));

-- 6. ------------------------------------------------------------------------
-- Security invoker: the counts are of the rows event_rsvps_read lets the caller read (an event they cannot see counts
-- nobody; people blocked either way are left out). At most 200 events a call.
create or replace function public.event_going_many(p_event_ids uuid[])
returns table (event_id uuid, going bigint, going_by_me boolean)
language sql
stable
security invoker
set search_path = public
as $$
  select
    t.id,
    (select count(*) from public.event_rsvps r where r.event_id = t.id),
    exists (select 1 from public.event_rsvps r where r.event_id = t.id and r.user_id = (select auth.uid()))
  from unnest(p_event_ids[1:200]) as t(id);
$$;
revoke all on function public.event_going_many(uuid[]) from public, anon;
grant execute on function public.event_going_many(uuid[]) to authenticated;

-- =============================================================================
-- Rollback of 20261121000000_event_engagement.sql (likes, comments and who is going, on events).
-- Takes out who is going (the table and its rows), the event checks and policy, and the 'event' target type, after
-- deleting the likes and comments made on events (with their replies and hearts, by the foreign keys): the target-type
-- checks cannot come back while such rows are there. post_link goes back to migration 20's text, word for word.
-- Safe to run more than once.
-- =============================================================================
drop function if exists public.event_going_many(uuid[]);
drop table if exists public.event_rsvps;

drop policy if exists "post_comments_event_audience" on public.post_comments;
drop trigger if exists post_comments_event_check on public.post_comments;
drop trigger if exists post_likes_event_check on public.post_likes;
drop function if exists public.event_engagement_check();

delete from public.post_likes where target_type = 'event';
delete from public.post_comments where target_type = 'event';
alter table public.post_likes drop constraint if exists post_likes_target_type_check;
alter table public.post_likes add constraint post_likes_target_type_check check (target_type in ('apartment', 'item', 'roommate', 'post'));
alter table public.post_comments drop constraint if exists post_comments_target_type_check;
alter table public.post_comments add constraint post_comments_target_type_check check (target_type in ('apartment', 'item', 'roommate', 'post'));

-- CampConnect Admin's target_visible() as its own file has it (no 'event' case), where that schema is installed.
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
          else false
        end;
      $$
    $f$;
  end if;
end
$do$;

create or replace function public.post_link(p_target_type text, p_target_id uuid)
returns text
language sql
immutable
as $$
  select case p_target_type
    when 'apartment' then '/apartments/'
    when 'item' then '/marketplace/'
    when 'post' then '/posts/'
    else '/roommates/'
  end || p_target_id;
$$;

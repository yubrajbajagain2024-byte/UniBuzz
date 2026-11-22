-- =============================================================================
-- UniBuzz - migration 68: liking your own story
-- Follows 20261119000000_admin_authority.sql (migration 67) in file order, but needs nothing of it: it replaces one
-- policy of migration 62 (20261114000000_story_actions.sql, on production), and nothing else.
-- Rollback: supabase/rollbacks/20261120000000_story_self_like.down.sql. Safe to run more than once.
--
-- Migration 62 kept a heart off your own story: its insert policy demanded the story's author be somebody else. The
-- owner asked for your own story to be likeable like anyone else's (2026-11-21), so that one condition goes. Everything
-- else about a like is unchanged: still only as yourself, still only on a story you may see right now (the subquery
-- reads public.stories through its own select policy, so the audience, the expiry and blocks all still decide), still
-- read by the person who liked it and by the story's author alone, still deleted only by its owner.
--
-- The author already sees every like of their stories (story_likes_select), and the list of views marks who liked it;
-- a self-like simply shows the author there too. No column, table, grant or function changes.
-- =============================================================================

-- Only as yourself, and only a story you may see right now: the subquery reads stories through their select policy
-- (audience, expiry, blocks), so a hidden or expired story is simply not there. Your own story is one of them.
drop policy if exists "story_likes_insert_own" on public.story_likes;
create policy "story_likes_insert_own" on public.story_likes
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.stories s where s.id = story_id)
  );

-- =============================================================================
-- Rollback of 20261120000000_story_self_like.sql (liking your own story).
-- Puts migration 62's insert policy back, word for word, so a story's own author may not like it again. Existing
-- self-likes are left alone: the policy governs new rows, and deleting someone's likes is not a rollback's business.
-- Remove them first if they must go: `delete from public.story_likes l using public.stories s where s.id = l.story_id
-- and s.author_id = l.user_id`.
-- Safe to run more than once.
-- =============================================================================
drop policy if exists "story_likes_insert_own" on public.story_likes;
create policy "story_likes_insert_own" on public.story_likes
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.stories s where s.id = story_id and s.author_id <> (select auth.uid()))
  );

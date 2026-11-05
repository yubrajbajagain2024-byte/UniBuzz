-- =============================================================================
-- Rollback of 20261118000000_calls_paused.sql (calls paused for the launch).
-- Run as one transaction. Drops the guard, so start_call() starts and rings calls again; nothing else changes, since
-- the migration left every call function and grant as it was. The calls it ended when it ran stay ended (they are
-- history now). Calls come back in the app only in a build with EXPO_PUBLIC_CALLS_ENABLED=1: the owner's decision.
-- =============================================================================
drop trigger if exists calls_paused on public.calls;
drop function if exists public.guard_calls_paused();

-- =============================================================================
-- UniBuzz - migration 64: calls paused for the launch
-- Follows 20261115000000_console_business.sql (migration 63, not on production) in file order. Needs only migration
-- 35's calls (the calls table, end_call()) and 36's ring, both on production. No pending migration (44, 46, 49 to 57,
-- 63) touches calls, so it can go live on its own, ahead of them, as 58 to 62 did.
-- Rollback: supabase/rollbacks/20261116000000_calls_paused.down.sql. Safe to run more than once.
--
-- Audio and video calls are postponed for the launch to hold down what they cost to run (the owner's decision,
-- 2026-11-02; docs/decisions.md). The app already offers no way to start one (CALLS_PAUSED in
-- apps/mobile/src/lib/calls.ts); this makes the database refuse as well, so a signed-in request made outside the app
-- cannot start a call, ring anyone or reach LiveKit either:
--   * guard_calls_paused(), before insert on public.calls: no new call, whoever asks (the API's roles, the service
--     role, a function). start_call() writes the call before it rings anyone or writes the chat's row, so the refusal
--     undoes all of it: no ringing participant, no push, no message, no notification. start_call(), its grants and
--     every other call function stay exactly as they are, ready for when calls come back.
--   * A call still ringing or going on when this runs is ended as the app would end it (a ring as missed, with its
--     missed-call notification; a call in progress as completed), so nobody can answer or join one any more and the
--     livekit-token function, which serves only the people in a call that is not over, has nothing left to serve.
--     Calls already over, their rows in the chats and their notifications are kept: past calls stay as history.
-- Calls come back with the rollback (and EXPO_PUBLIC_CALLS_ENABLED=1 in the app's build), on the owner's decision.
-- =============================================================================

create or replace function public.guard_calls_paused()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Calls are paused for now.';
end;
$$;

revoke all on function public.guard_calls_paused() from public, anon, authenticated;

drop trigger if exists calls_paused on public.calls;
create trigger calls_paused
  before insert on public.calls
  for each row execute function public.guard_calls_paused();

-- What is still open ends now, the way the app's own hang-up would end it.
do $$
declare
  v_call record;
begin
  for v_call in select id, status from public.calls where status <> 'ended' order by started_at loop
    perform public.end_call(v_call.id, case when v_call.status = 'ringing' then 'missed' else 'completed' end);
  end loop;
end
$$;

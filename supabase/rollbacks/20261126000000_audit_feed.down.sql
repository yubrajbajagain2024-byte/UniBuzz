-- Rollback of migration 71 (20261126000000_audit_feed.sql): the portal's one audit view and the triggers that record
-- where staff actions came from. Run in one transaction with
--   delete from public._migrations where name = '20261126000000_audit_feed.sql';
-- then notify pgrst, 'reload schema'.
--
-- It deliberately keeps public.audit_request_context and its rows: they are a record of what the staff did, and the
-- logs they belong to are append-only too. The table stays closed to the API; applying 71 again reuses it. Dropping it
-- is a separate decision for the owner (export it first). The two indexes for the merge stay as well: they cost little
-- and only help the logs' readers.

drop function if exists public.console_audit_feed(jsonb, int);
drop function if exists public.audit_context_json(text, text);

drop trigger if exists audit_log_request_context on public.audit_log;
drop trigger if exists business_audit_log_request_context on public.business_audit_log;
do $$
begin
  if to_regclass('public.staff_audit_log') is not null then
    execute 'drop trigger if exists staff_audit_log_request_context on public.staff_audit_log';
  end if;
end;
$$;

drop function if exists public.audit_capture_context();
drop function if exists public.audit_actor_is_staff(uuid);
drop function if exists public.audit_context_text(text, int);

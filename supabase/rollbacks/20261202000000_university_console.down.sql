-- Rollback of migration 77 (20261202000000_university_console.sql): universities in the portal. Run in one transaction
-- with
--   delete from public._migrations where name = '20261202000000_university_console.sql';
-- then notify pgrst, 'reload schema'.
--
-- It drops the five functions 77 added; the universities keep the details and domains set through them (those are
-- data, written to the staff audit log), and calendar feeds keep migration 61's functions. Nothing is refused.

drop function if exists public.console_set_university_domain(uuid, text);
drop function if exists public.console_update_university(uuid, jsonb);
drop function if exists public.console_university(uuid);
drop function if exists public.console_universities(text);
drop function if exists public.console_university_json(uuid);

notify pgrst, 'reload schema';

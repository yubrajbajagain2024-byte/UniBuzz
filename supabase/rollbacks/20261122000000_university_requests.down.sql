-- Rollback of migration 70 (20261122000000_university_requests.sql): students' university requests and their review.
--
-- It refuses while any request exists, so none is lost by accident: export them first (in the SQL editor,
-- `select * from public.university_requests`), delete them on purpose, then run this file. Universities added by
-- approving a request stay (they are ordinary rows, and profiles may point at them).
--
-- It does NOT bring back migration 1's universities_insert policy as it was (any signed-in account inserting any
-- column, the sign-up email domain included). Students get back only what the website's old "Add university" form
-- sends: a name, a city and a country, never an email domain or anything else.

do $$
begin
  if to_regclass('public.university_requests') is not null then
    if exists (select 1 from public.university_requests) then
      raise exception 'university_requests has rows: export and delete them before rolling back migration 70';
    end if;
  end if;
end;
$$;

drop function if exists public.console_decide_university_request(uuid, text, text, text, text, uuid, text);
drop function if exists public.console_university_requests(text, int, int);
drop function if exists public.my_university_requests();
drop function if exists public.request_university(text, text, text, text);
drop function if exists public.university_request_json(public.university_requests, boolean);
drop function if exists public.university_request_text(text);
drop table if exists public.university_requests;

revoke all on public.universities from public, anon, authenticated;
grant select on public.universities to anon, authenticated;
grant insert (name, city, country) on public.universities to authenticated;
drop policy if exists "universities_insert" on public.universities;
create policy "universities_insert" on public.universities
  for insert to authenticated
  with check (email_domain is null and latitude is null and longitude is null);

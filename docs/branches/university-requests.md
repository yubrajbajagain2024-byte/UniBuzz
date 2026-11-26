# university-requests

- **Owner:** Sunil. **As of 2026-11-25:** branched from `main` at `5a1ef63` (PR #124); **local only, not pushed**: it
  closes a security weakness that is still open on production (below), and the repository is public (root CLAUDE.md,
  "Security and privacy"). Push it only after migration 70 is live on production. Written by an AI session.
- **Purpose:** Phase 0 of the **UniBuzz Master Admin Portal** roadmap (the owner's approval of 2026-11-25; the roadmap is
  in [../status.md](../status.md), its decisions in [../decisions.md](../decisions.md)): close student writes to the
  `universities` table and replace "add your university" with requests the UniBuzz team reviews in CampConnect Admin.

## The weakness (open on production until 70 is applied)

Migration 1's policy `universities_insert` (`for insert to authenticated with check (true)`), never narrowed since, lets
any signed-in account insert a `universities` row with **any** column through the REST API, `email_domain` included.
`university_for_email()` then accepts that domain, so the `before insert` trigger on `auth.users` lets anyone with an
address there sign up as a "verified" student of a made-up university, which breaks "verified university students
only". Nobody could take over `txstate.edu` (its domain is unique) or change a row (no update policy). Found by the
admin-portal audit of 2026-11-25 and reproduced offline in PGlite in both migration orders (the "before" checks of
`university-requests.test.mjs`); **production not checked yet**: the read-only checks below come first.

## What it changes

- **Migration 70** (`supabase/migrations/20261122000000_university_requests.sql`; rollback beside it in
  `supabase/rollbacks/`): drops `universities_insert` and leaves anon and authenticated only SELECT on `universities`
  (the service role, the database owner and the staff functions still write it); adds `university_requests` (closed to
  the API), `request_university()` and `my_university_requests()` for students, and `console_university_requests()` and
  `console_decide_university_request()` for owners and admins of the staff with a second factor (`ts_require_admin`).
  Approving adds a university **without an email domain** (opening sign-up is the owners' separate step, a later
  phase); linking points a request at a university already listed; approving or linking answers the other pending
  requests for the same name. Every decision and every university added goes to the staff audit log (`console_audit`).
  Limits: confirmed, not a business account, not suspended or muted everywhere, 3 pending and 5 a day per student, no
  name already listed, no second request for the same name. A request is deleted with its student's account.
- **The rollback** refuses while requests exist, and deliberately does not restore migration 1's open policy: students
  get back only what the old form sends (a name, a city and a country, never a domain or coordinates).
- **Website:** Settings › Profile's "Can't find your university? Add it" becomes "Ask us to add it" (`requestUniversityAction`,
  `RequestUniversityForm`), with an optional note and the student's own requests and the team's replies. `createUniversity`
  is gone from `packages/shared`; `requestUniversity` and `listMyUniversityRequests` replace it.
- **CampConnect Admin:** a tenth section, **Universities** (`/universities`, owners and admins), the requests queue (waiting,
  added or linked, declined) with approve (name, city and country editable), link and decline, the reply and similar
  names; its pending count on the dashboard; audit labels. Also `hasBusinessRole()` now asks `admin_standing()` (the
  database's rule since migration 67) instead of `profiles.role`, with the old rule only where 67 is missing, and the
  Business notices say so.
- The mobile app has no "add university" and needs nothing.

## Tests (2026-11-25, on this branch)

- `supabase/tests/university-requests.test.mjs`: 96 checks (48 in this repo's order, 48 in production's), in `db:test`.
  `moderation-support.test.mjs` now accepts "permission denied" for a suspended student's university insert, and 70 is
  in the five rollout suites' `AHEAD` lists.
- `npm run typecheck`, `npm run lint`, `npm run build` (the website and CampConnect Admin, `/universities` built),
  `npm run test:shared` 316/316: all pass. `npm run db:test`: 66 suites, 2350 checks, 0 failures ([../testing.md](../testing.md)).
- **Not run yet:** `supabase/tests/staging/university-requests.mjs` (needs `SUPABASE_ACCESS_TOKEN` and
  `STAGING_SUPABASE_REF`; it refuses production) and `apps/admin/e2e/admin.mjs` against staging (now checks
  `/universities` for admins and that a moderator cannot open it).

## Rollout (each production step needs the owner's explicit approval)

1. **Read-only checks on production** (SQL editor or `psql`), before anything else:
   ```sql
   select name, email_domain, created_at from public.universities where email_domain is not null order by created_at;
   select name, city, country, created_at from public.universities where created_at > '2026-09-07' order by created_at;
   select has_table_privilege('authenticated', 'public.universities', 'INSERT') as students_can_insert;
   select exists (select 1 from public._migrations where name = '20261122000000_university_requests.sql') as already_applied;
   ```
   Expect `txstate.edu` as the only domain, `true`, `false`. Any other domain: stop and decide with the owner (whose
   accounts signed up through it: `select id, email, created_at from auth.users where split_part(email, '@', 2) = '<domain>'`).
2. **Staging:** `SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=… node supabase/tests/staging/university-requests.mjs`
   (applies 70 alone, checks it through Auth, the REST API and the apps' queries, rolls it back, applies it again,
   deletes what it made). Then the admin browser check against staging.
3. **Backup:** `node scripts/backup.mjs before-migration-70 --full` (the owner's Mac).
4. **Apply 70 alone** in one transaction with its `_migrations` row, then `notify pgrst, 'reload schema'`
   (supabase/CLAUDE.md, "To apply one migration alone"). Between this step and the merge, the website's old "Add it"
   form answers with a permission error (a rarely used form); nothing else changes for students.
5. **Verify** (read-only): step 1's privilege check says `false`; `verify.mjs --live` matches; a staff admin opens
   `/universities` after the merge.
6. **Push the branch, open the PR, merge** (deploys the website and CampConnect Admin). Then record 70 in
   docs/migrations.md and docs/history.md.
- **Rollback:** the rollback file with its `_migrations` delete, newest first, after exporting and deleting any
  requests. It keeps student writes narrow (no domain).

## Next

- Phase 1 on its own branch (pushable at once): the name "UniBuzz Master Admin Portal" on screen (identifiers unchanged,
  CLAUDE.md's naming rule changed in the same PR), one audit view over the three audit logs with request context, a
  Content-Security-Policy, navigation from permissions.
- The audit found one more gap, for Phase 4's sanction unification; its details stay out of the repository until its
  fix is live on production (root CLAUDE.md, "Security and privacy").

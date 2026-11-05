# Admin authority fix (migration 67): rollout plan

**Status: done, 2026-11-05.** Option B was followed, each step with the owner's approval: a full backup, the website
from the branch, migration 67 alone (04:15 UTC), then PR #106 (22:31 CST); see docs/migrations.md and docs/history.md.
The plan is kept as the record of how it was checked and rolled out; its two product questions are still open.

## The problem (live since 2026-10-25; still open on production, read-only check 2026-11-05)

Migration 39's `is_admin()` checks only `profiles.role = 'admin'`. `require_admin()` and several
row-level security policies rely on it. On production, where CampConnect Admin's staff list
governs every other staff power, that means:

- the business portal's admin actions work with a **password alone, without two-factor sign-in**:
  approving, rejecting or suspending a business, "Verified Partner", recording or cancelling a paid
  promotion ("Sponsored"), listing businesses and promotions, and admin read access to pending
  businesses, their teams and inquiries; since Business v2 (2026-11-03) also reviewing, approving,
  rejecting and pausing ads, recording and cancelling ad payments, business reports and the audit log
  (about 20 functions in migrations 49, 50, 56 and 63 call `is_admin()` / `require_admin()`);
- a **suspended** staff admin keeps them;
- someone **removed from the staff list** keeps them, because migration 39 copied staff owners and
  admins into `profiles.role` once (2026-10-25) and nothing removes the role.

Who can use it: only accounts that hold `profiles.role = 'admin'`; nobody can give themselves the
role. The realistic risks are a stolen admin password and a former or suspended staff member.

## The fix

**Database:** `supabase/migrations/20261119000000_admin_authority.sql`

- `admin_standing()` (new; signed-in callers learn their own standing only). Where `public.staff`
  exists, it returns `'admin'` for a staff owner or admin who is not suspended and whose session is
  aal2 with a verified factor; `'mfa_required'` for such a staff member without aal2; otherwise
  null. Without the staff list (a database built from this repo alone) the role decides, as before.
- `is_admin()` is now `admin_standing() = 'admin'`. Policies and functions keep calling it; no
  policy changes.
- `require_admin()`: `'mfa_required'` raises 42501 with hint `MFA_REQUIRED`; everyone else gets the
  old error.
- No data changes; `profiles.role` is left as it is.

**Website**

- `requireAdmin()` (the portal's admin page and its four server actions) asks `admin_standing()`.
  `'mfa_required'` goes to the portal's new `/two-factor` page; anything but `'admin'` is "not
  found". On a database without migration 67 it falls back to the role rule, so **the website is
  safe to deploy before the migration** (and after a rollback).
- New page `apps/web/src/app/business/(portal)/two-factor/page.tsx`, reusing `StaffTwoFactor` (now
  with `doneHref` and `subject` props).

**Tests:** `supabase/tests/admin-authority.test.mjs`, 34 checks on production's schema order and on
the repo-only schema, including rollback and re-apply, and Business v2's ad-review, payment, report and
pause tools; added to `npm run db:test`. Other suites follow: `ad-delivery.test.mjs`'s team admin is a
staff owner with a second factor, as production requires; the rollout suites leave 67 out (`AHEAD`)
until it is live; `permissions-audit.test.mjs` lets `admin_standing()` answer a student, as `admin_me()`
does, and checks it tells them nothing. On staging: `supabase/tests/staging/admin-authority.mjs`.

## Before you approve: read-only checks on production

Run on 2026-11-05 (counts only): production has 1 account with the admin role, and it is its 1 staff
admin, with a verified authenticator; no one with the role alone; `is_admin()` is migration 39's role
rule; `admin_standing()` absent; no `_migrations` row for the fix. So nobody loses the admin screens
unexpectedly, and nobody is left without a factor. Rerun them just before the migration.

Run in the SQL editor (or `psql "$SUPABASE_DB_URL"`). Nothing here writes.

1. Who keeps and who loses the admin screens:

   ```sql
   select p.id, p.full_name, p.role as profile_role, s.role as staff_role,
          public.is_suspended(p.id) as suspended,
          exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified') as has_factor
   from public.profiles p
   left join public.staff s on s.user_id = p.id
   where p.role = 'admin' or s.role in ('owner', 'admin')
   order by 3, 4;
   ```

   - `profile_role = 'admin'` and `staff_role` null: **loses access** (intended). Confirm each one.
   - `staff_role` owner or admin but `profile_role` not `'admin'`: the database would allow them, but
     the portal's menu and gate still start from the role. If they should review businesses, that
     needs `select public.grant_role('<id>', 'admin');`, a write and a separate approval.
   - `has_factor = false`: they will be asked to add an authenticator app on the portal's two-factor
     page. That works; tell them beforehand.

2. What the migration relies on exists, and it has not run yet:

   ```sql
   select to_regclass('public.staff') as staff, to_regprocedure('public.is_suspended(uuid)') as is_suspended,
          to_regclass('auth.mfa_factors') as mfa_factors,
          exists (select 1 from public._migrations where name = '20261119000000_admin_authority.sql') as already_applied;
   ```

   Expect three non-null values and `false`.

3. Take the usual read-only backup first, as for migrations 43–45
   (`scripts/backup.mjs before-migration-67 --full`, as for 58 to 66).

## Rollout

`main` deploys production on every push, so **merging is deploying**. The website change has to be
live before the migration; otherwise staff admins have no way to pass two-factor on the portal and
the admin screens stop working.

**Option A, through the pull request (simplest; minutes between the public fix and the patched
database):**

1. Push `fix/security-2026-10-27` and open its PR into `main` (it has `main` merged in, 2026-11-05). Keep
   the PR text generic ("tighten admin authority for the business portal") until step 3 is done, and
   keep this file and the branch's notes out of the pushed branch until then: they say how the gap works.
2. Merge and wait for Vercel. Check that the portal's admin screens still open for you as before
   (the role fallback).
3. Apply migration 67 **on its own**, in one transaction, with its tracking row:

   ```sql
   begin;
   -- paste supabase/migrations/20261119000000_admin_authority.sql here
   insert into public._migrations (name) values ('20261119000000_admin_authority.sql') on conflict do nothing;
   commit;
   notify pgrst, 'reload schema';
   ```

   **Do not use `npm run db:setup` for this.** Apply the one file, as 58 to 66 were applied.
4. Verify (below).

**Option B, patched before anything is public:** deploy the website from this branch with
`vercel deploy --prod --yes --archive=tgz` (production then runs this branch's build), apply
migration 67 as in step 3, verify, then push and merge the PR (main's automatic deploy rebuilds
the same code).

## Verify on production

- `select pg_get_functiondef('public.is_admin()'::regprocedure);` mentions `admin_standing`.
- As a staff admin: the portal's admin screen leads to the two-factor page, a code opens the
  Businesses list, and approving or rejecting still works.
- As an account with the admin role but no staff row (if check 1 found one): the admin screen
  answers "not found".
- A student account: nothing changes.
- CampConnect Admin and the website's `/admin` console: unchanged; they never used `is_admin()`.

## Rollback

```sql
begin;
-- paste supabase/rollbacks/20261119000000_admin_authority.down.sql here
delete from public._migrations where name = '20261119000000_admin_authority.sql';
commit;
notify pgrst, 'reload schema';
```

The website needs no change to roll back: without `admin_standing()` it uses the role rule again.

## Open questions for the owner

1. Should recording or cancelling a paid promotion ("Sponsored") need a staff **owner** rather than
   an admin, as `step-admin`'s merge plan suggests? The fix keeps admin.
2. Should the business review screens move into CampConnect Admin later, so the website carries no
   admin controls (`step-admin`'s plan)?
3. Option A or option B?

## Notes

- The tests reproduce production's schema order with `boot({ live: true })`. That order lacks
  `step-admin`'s migration 18 (`20261103100200_staff_invite_email.sql`), which production has but
  which is in neither `supabase/migrations/` nor `supabase/applied-outside-repo/`. Per its commit
  message, 18 changes staff invitations only, not the staff list, suspensions or two-factor.
- No migration since 39 redefines `is_admin()` or `require_admin()` (checked against `main`, 2026-11-05),
  so 67 replaces exactly migration 39's definitions, and its rollback restores them (rehearsed on staging).

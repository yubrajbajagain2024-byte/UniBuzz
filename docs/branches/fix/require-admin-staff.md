# fix/require-admin-staff

- **Owner:** Sunil. **As of 2026-10-27:** local only, **not pushed**; the repository is public, so it
  is pushed the way [../../admin-authority-rollout.md](../../admin-authority-rollout.md) says
  (option A or B), not earlier. One commit of its own on top of `docs/claude-structure` (the
  documentation PR), plus this file.
- **Purpose:** close the gap in who counts as an admin for the business portal's staff actions
  (migration 39's `is_admin()` / `require_admin()`) without locking staff admins out of the portal.
  Open work item 2 in [../../status.md](../../status.md).

## Completed

- Migration 48, `supabase/migrations/20261106000000_admin_authority.sql`, its rollback in
  `supabase/rollbacks/`, and `supabase/tests/admin-authority.test.mjs` (26 checks, in `db:test`).
  What it changes and why: the rollout plan.
- Website: `requireAdmin()` in `apps/web/src/lib/business/portal.ts` asks the database
  (`getAdminStanding()` in `packages/shared/src/queries/business.ts`, with a fallback to the role
  before the migration), and a staff admin without two-factor sign-in goes to the new
  `apps/web/src/app/business/(portal)/two-factor/page.tsx`. `StaffTwoFactor` takes `doneHref` and
  `subject`. Type for `admin_standing` in `packages/shared/src/types/database.ts`.
- [../../admin-authority-rollout.md](../../admin-authority-rollout.md): read-only checks on
  production, rollout order (website before the migration; 48 on its own), verification, rollback,
  three open questions.

## Current progress

- Waiting for the owner to approve the plan. **Nothing applied to production.**

## Pending

- [ ] Owner: run the plan's read-only checks and answer its three questions (owner-only
      promotions? move business review into CampConnect Admin? option A or B?).
- [ ] Push and open the PR (generic text), merge it (that deploys the website), apply migration 48
      on its own, verify; or option B.
- [ ] In that PR, after merging `main` in, update the shared files: a migration 48 row in
      docs/migrations.md (and the rule that 48 goes first, on its own, never through `db:setup`),
      the suite count and results in docs/testing.md, open work item 2 in docs/status.md, the
      plan in docs/README.md's map, and this branch's row in docs/branches/README.md.
- [ ] Once live: mark 48 applied in docs/migrations.md, close status item 2, update the README's
      business-portal section, then retire this file (docs/history.md).

## Tests

- 2026-10-27, before this rebase (on `main` @ `9227e04` + the docs): `npm run check` 6/6 tasks with
  0 warnings; `test:shared` 157/157; `db:test` 1293 checks across 33 suites, 0 failures
  (admin-authority 26/26). After rebasing onto `docs/claude-structure` (`main` @ `d9fb4b1`):
  admin-authority 26/26.
- **Not tested:** the portal's two-factor page in a browser (it needs a project with migration 48
  and a TOTP factor), and the live suites.

## Next steps

1. Read the rollout plan and get the owner's decisions.
2. Before the migration step, try the two-factor page on a staging project if one is available.
3. Follow the chosen option; then update the docs as above.

# admin-portal-phase-3

- **Owner:** Sunil. **As of 2026-11-27:** branched from `main` at `9cc6181` (PR #132's merge); `main` merged in at
  `ba60b7b` (Phase 2 complete, 75 and 76 live). 77 touches nothing 72 to 76 change (five new functions, no table,
  policy or trigger) and no function of 78 (`admin-portal-phase-4`). Written by an AI session.
- **Purpose:** Phase 3 of the **UniBuzz Master Admin Portal** roadmap ([../status.md](../status.md)): universities in
  the portal. Campus details, sign-up domains opened by owners only, and calendar feeds moved from the website's
  console.

## What Phase 3 changes

- **Migration 77** (`supabase/migrations/20261202000000_university_console.sql`; rollback in `supabase/rollbacks/`):
  - `console_universities(q)` and `console_university(id)` (owners and admins, second factor: `ts_require_admin`):
    each university's details, its sign-up domain, its verified students (confirmed accounts signing in with that
    domain), its calendar feeds and its upcoming events.
  - `console_update_university(id, patch)` (owners and admins): name (unique), short name, city, country, time zone
    (one PostgreSQL knows), coordinates (both or neither; `geog` follows). Never the domain. Audited with before and after.
  - `console_set_university_domain(id, domain)` (**owners only**): open sign-up to a host name, or close it. Refused: a
    public mail provider, another university's domain, and **changing or closing a domain confirmed accounts already
    sign in with** (`verified_university()` reads it: those students would lose their verified campus; that stays a
    deliberate step for the database owner). Audited with from and to. Where CampConnect Admin's staff list is missing
    there are no owners, so it refuses everyone.
- **The portal:** Universities gets a **Campuses** tab: every university (sign-up open or closed, verified students,
  feeds, upcoming events, search) and a page per campus with its details form (owners and admins), its sign-up card
  (owners open or close; everyone else sees it) and its **calendar feeds** (add, change, pause, remove through migration
  61's functions, moved here from the website's console; "Sync now" stays on the website until Phase 9 retires its
  console, the daily sync reads every enabled feed either way).

## Tests (2026-11-27, on this branch)

- `supabase/tests/university-console.test.mjs`: both orders (every role refused or allowed, the second factor, every
  validation, the domain rules, a new domain's student placed by `verified_university()`, audits, grants, the rollback
  keeping the data). Mutation-checked: admins allowed to open a domain, and a domain in use allowed to close, each fail it.
- `npm run check` passes (built from scratch); `db:test` 71 suites, 2670 checks, 0 failures ([../testing.md](../testing.md));
  the new suite 52. Its first full run caught a helper taking the `universities` row type (a dependency that would hold
  up other migrations' rollbacks, `console-business.test.mjs`): it takes the id now.
- Staging: `supabase/tests/staging/university-console.mjs` **9/9** (run `mwykc5r0`, 2026-11-27), so **77 is on staging**.
- Browser, the portal's dev server against staging, in Chrome: `apps/admin/e2e/admin.mjs` (now also the Campuses list and
  a campus page: details, sign-up, feeds) passes as the staging admin.
- Again after merging `main` at `ba60b7b`: `npm run check` passes; `db:test` 73 suites, 2,752 checks, 0 failures; `apps/admin/e2e/admin.mjs`
  passes as the staging admin from this branch against staging (76, 77 and 78 there), the Campuses pages included.
  Production, read-only: none of 77's five functions exists there yet.

## Rollout

1. Staging: done (above).
2. Backup `before-migration-77` (full, 220 files, checksums verified, row counts matching the live project).
3. **Applied 2026-11-27 10:40:29 UTC** with the owner's approval, alone, after 78, in one transaction with its
   `_migrations` row. Verified (read-only): the owner's answers and every university row identical before and after;
   details in [../migrations.md](../migrations.md); `verify.mjs --live` the same schema.
4. `main` merged in again (78, Phase 4a); merge the PR after its checks pass.

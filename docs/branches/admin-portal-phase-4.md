# admin-portal-phase-4

- **Owner:** Sunil. **As of 2026-11-27:** branched from `main` at `68615c2`, `main` merged in at `ba60b7b` (Phase 2e,
  migration 76). Written by an AI session. Kept local and unpushed until migration 78 was live (root CLAUDE.md,
  "Security and privacy"); `main` merged in again at `a6379e5`.
- **Purpose:** Phase 4 of the **UniBuzz Master Admin Portal** roadmap ([../status.md](../status.md)): one moderation
  model. 4a, here: one standing for the staff across both sanction systems (migration 78). Then 4b, the website
  console's queue in the portal; 4c, one sanction system; 4d, safety metrics.

## What 4a changes

- **Migration 78** (`supabase/migrations/20261203000000_staff_standing.sql`; rollback in `supabase/rollbacks/`; needs
  41, 67 and 72, independent of 77):
  - `staff_sanctioned(user)` (internal): an active Trust & Safety suspension or ban covering the whole account (scope
    `all`, in effect, not lifted, not expired). A Buzz-only or requests-only sanction, a mute or a warning is not one.
  - `staff_role_of()` answers nothing for such an account (Trust & Safety's role, the portal's permissions and a campus
    admin's campuses go with it); `admin_standing()` answers nothing; `staff_require()` refuses it as suspended.
    Before 78 these read only CampConnect Admin's own suspensions (`is_suspended()`, `account_restrictions`).
  - Sign-in is unchanged (Trust & Safety ends the sessions; the account may sign in to read its status and appeal).
    Lifting or expiry gives the powers back at once.
- **The portal:** `getStaffAccess()` (`apps/admin/src/lib/admin.ts`) lets nobody in whom `admin_my_permissions()`
  answers with nothing, so a sanctioned staff member goes no further than `/no-access` (one cached call per request,
  shared with the permission lookup).

## Tests (2026-11-27, on this branch after merging `main` at `ba60b7b`)

- `supabase/tests/staff-standing.test.mjs`: 22 checks in production's order (every function and console refused under
  an account-wide suspension or ban; scoped, future, lifted and expired sanctions and mutes ignored; powers back on
  lifting; the helper internal; the rollback word for word, then 78 again).
- `npm run db:test`: 73 suites, 2,722 checks, 0 failures. `npm run check` passes.
- Production, read-only: the rollback's three functions are byte-for-byte production's current ones (76 live), and
  78's versions only add the new check to each.
- Staging: `supabase/tests/staging/staff-standing.mjs` **7/7** (run `mwyms620`), left applied there (after 76 and 77).
  The portal's dev server from this branch against staging, in Chrome: the staging admin, suspended account-wide in the
  same session, sent to `/no-access` on every page and given everything back when it was lifted (the sanction row
  removed afterwards); `apps/admin/e2e/admin.mjs` as the staging admin and moderator and `apps/admin/e2e/campus-admin.mjs`
  8/8 as the campus admin, all passing: staff who are not sanctioned see no change.

## Rollout

1. Staging: done (above).
2. Backup `before-migration-78` (full, 220 files, checksums verified, row counts matching the live project).
3. **Applied 2026-11-27 07:48:27 UTC** with the owner's approval, alone, in one transaction with its `_migrations` row,
   ahead of 77. Verified (read-only): the owner's answers identical before and after; details in
   [../migrations.md](../migrations.md); `verify.mjs --live` the same schema.
4. This branch pushed and its PR opened only after that; merge it after its checks pass.

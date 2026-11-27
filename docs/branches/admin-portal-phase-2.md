# admin-portal-phase-2

- **Owner:** Sunil. **As of 2026-11-26:** branched from `main` at `ef83f02` (PR #128). Written by an AI session.
- **Purpose:** Phase 2 of the **UniBuzz Master Admin Portal** roadmap (the owner's approval of 2026-11-25; roadmap in
  [../status.md](../status.md), decisions in [../decisions.md](../decisions.md)): campus scopes, the Campus Admin role,
  `staff_can()` in SQL, every staff function scoped before any campus staff exist. Built in layers, each with its own
  migration and PR, all "default deny until scoped":
  - **2a (this branch, migration 72): the foundation.** The role, the campuses table, every role resolver default-deny,
    the permission table in SQL, the portal reading it. A campus admin has no permissions and lands on `/no-access`.
  - **2b to 2d (next):** scope one area at a time (moderation and the queue by `mod_queue.university_id`; users by their
    verified university; events and organizations by `university_id`), each migration adding its permissions to the
    campus admin's set in `staff_role_permissions()` and switching those functions to `staff_require_can(permission,
    university)`; then the portal's campus-admin shell and the owners' screens to appoint campus admins and their
    campuses (the team-management functions still refuse the role).

## What 2a changes

- **Migration 72** (`supabase/migrations/20261127000000_staff_scopes.sql`; rollback in `supabase/rollbacks/`):
  - `campus_admin` allowed by the role checks of `staff`, `staff_invites` (CampConnect Admin's, where they exist) and
    `staff_members`. Nothing grants it through the API: `admin_staff_add`, `admin_staff_set_role` and the invitations
    still accept owner, admin and moderator only.
  - `staff_campuses (user_id, university_id, granted_by, created_at)`, closed to the API; its people are `auth.users`
    (see "Found on staging" below).
  - `staff_role_of(user)` (the stored role, null when not staff or suspended). `ts_role_of()` now maps owner and admin to
    'admin', moderator to 'moderator' and **anything else to nothing**: before, every role but moderator was 'admin', so a
    campus admin would have had platform-wide Trust & Safety, events, universities and audit powers. `ts_staff_ids()`
    leaves unknown roles out of staff notices. `staff_role_rank()` and `admin_standing()` already refused them.
  - `staff_role_permissions(role)` (the portal's `lib/permissions.ts` in SQL; campus_admin: none yet), `staff_can(
    permission, university)` (platform roles anywhere; a campus admin only for their campuses, never platform-wide),
    `staff_require_can()` (not found, or the second factor first): internal, like every `staff_*` helper.
    `admin_my_permissions()` (beside `admin_me()`): the caller's own role, campuses, permissions and second factor.
- **The portal:** `getStaffPermissions()` (lib/admin.ts) reads `admin_my_permissions()` (falling back to the local
  table where 72 is missing); the shell, the tabs and every `requireStaff(…, { permission })` use it. A role the portal
  does not know (a campus admin, until 2b) gets no access instead of a rank comparison that would loop.
- `packages/shared`: `getMyStaffPermissions()`, the `StaffPermissions` type, the function's type.

## Tests (2026-11-26, on this branch)

- `supabase/tests/staff-scopes.test.mjs`: in this repo's order and production's; reads the portal's
  `lib/permissions.ts` and fails if the SQL table differs; checks no table links profiles and universities through its
  primary key. `permissions-audit.test.mjs` lists `admin_my_permissions` beside `admin_me` and `admin_standing` (a
  student is told nothing). 72 is in the five rollout suites' `AHEAD` lists.
- Staging: `supabase/tests/staging/staff-scopes.mjs` 17/17 (run `mwy30kg1`): **72 is on staging**. The portal's browser
  check passes as the staging admin and moderator against a local production build; a one-off check: a campus admin
  signing in lands on `/no-access` without a loop, and the account was deleted.
- `npm run check`, `test:shared` 316/316 and `db:test` (68 suites, 2492 checks, 0 failures) pass ([../testing.md](../testing.md)).

## Found on staging, fixed before any PR

The first version of 72 gave `staff_campuses` foreign keys to `profiles` and `universities` inside its primary key.
PostgREST read it as a many-to-many link between the two, so every existing embed of a profile's university became
ambiguous (`PGRST201`): the portal failed to render and the website's and the app's profile queries failed on
staging, for about 15 minutes in all on 2026-11-26 (the two rehearsals until the rollback). 72 was rolled back on
staging, the table now points at `auth.users`, the PGlite suite checks no table links the two, and the staging script
asks for a profile with its university as the apps do. Production never had it. The rule is in supabase/CLAUDE.md.
`staff_can` and the first name of `admin_my_permissions` (`staff_permissions`) were also API-callable at first, against
CampConnect Admin's rule that `staff_*` helpers are internal; `permissions-audit` caught it.

## Rollout

1. Staging: done (above).
2. Backup: `before-migration-72` (full, 222 files, checksums verified, row counts matching the live project).
3. **Applied 2026-11-27 00:15:41 UTC** with the owner's approval, alone, in one transaction with its `_migrations` row.
4. Verified (read-only): details in [../migrations.md](../migrations.md); `verify.mjs --live` the same schema.
5. Merge PR #129 (the portal then reads its permissions from SQL).
- **Rollback:** the rollback file with its `_migrations` delete (refused while any campus admin or campus exists).

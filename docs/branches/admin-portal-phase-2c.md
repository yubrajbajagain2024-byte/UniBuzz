# admin-portal-phase-2c

- **Owner:** Sunil. **As of 2026-11-27:** branched from `admin-portal-phase-2b` (2b, PR #130, migration 73) at
  `98f051b`, stacked on it because 74 needs 73. Written by an AI session.
- **Purpose:** Phase 2c of the **UniBuzz Master Admin Portal** roadmap ([../status.md](../status.md); 2b in
  [admin-portal-phase-2b.md](admin-portal-phase-2b.md)): users, suspensions and appeals scoped by campus. Campus admins
  get `users.view`, and Appeals (under `moderation.view`, refused to them until now) opens for their own students.

## What 2c changes

- **Migration 74** (`supabase/migrations/20261129000000_campus_users.sql`; rollback in `supabase/rollbacks/`):
  - `staff_role_permissions('campus_admin')` = `{moderation.view, users.view}`.
  - `staff_user_university(user)` (internal): a person's verified campus, and **none for anyone on the staff list** (any
    role, suspended or not): owners and admins manage the staff, so a campus admin never sees, suspends or reviews
    another staff member. `staff_content_university()` (73) now goes through it: a staff member's content and profile
    leave every campus too.
  - Trust & Safety: `ts_require_area(permission)` (internal; `ts_require_staff()` word for word for everyone else).
    `console_appeals` and `console_decide_appeal` show and decide only the campus admin's own students' appeals (others
    "not found"), never one against a suspension or a ban (already admin-only for moderators), recorded as
    `campus_admin` in `audit_log` (which has no role check; `moderation_actions`' check is untouched, since only the
    queue writes it).
  - CampConnect Admin: `admin_users_list`, `admin_user_search`, `admin_user_get`, `admin_restrictions_list`,
    `admin_user_suspend`, `admin_user_unsuspend` on `staff_require_area('users.view')`, scoped by the person's campus
    ("User not found" otherwise).
  - **One new rule for the platform's staff:** only an owner or an admin may suspend or lift a campus admin.
    `staff_role_rank()` gives the role 0 (so `staff_require()` never lets it in platform-wide), which let a moderator
    outrank it; unreachable on production (no campus admin exists or can be appointed), fixed before 2d can appoint one.
  - Every other answer to owners, admins and moderators unchanged (the suite compares them whole).
- **The portal:** `lib/permissions.ts` `CAMPUS_ADMIN` adds `users.view` (74 is the newest scoping migration, so its suite
  compares it); 73's suites now check 73's own set. The website's staff type knows the `campus_admin` actor role.

## Tests (2026-11-27, on this branch)

- `supabase/tests/campus-users.test.mjs`: production's order (users and appeals, the platform's answers before and after,
  the new suspension rule, a student verified elsewhere naming the campus, staff and the unconfirmed out of scope, a
  staff member's post out of reach, no campus, no second factor, suspended, every other area refused, grants, the
  helpers closed, the rollback word for word) and this repo's order (appeals, the rollback). Mutation-checked: the user
  list without its filter, staff keeping a campus, and an appeal decided without the campus check each fail it.
- First run found that `audit_log` has no `actor_role` check (only `moderation_actions` has), so 74 changes no
  constraint; production checked read-only the same way.
- `npm run check` passes; `db:test` 70 suites, 2618 checks, 0 failures ([../testing.md](../testing.md)); the new suite 68.
- Staging: `supabase/tests/staging/campus-users.mjs` **14/14** (run `mwy94ao3`, 2026-11-27): through the portal's own
  queries and the appeals functions, students of two campuses (a throwaway sign-up domain, removed after), the platform's
  answers unchanged, the campus admin's users, suspensions and appeals in and out of scope, the new suspension rule, the
  helpers closed, a profile's university embeddable; rolled back and applied again, so **74 is on staging**. Every
  table's row count as at the start (10 log rows stay, append-only).

## Rollout (after 73; each step waits on the owner)

1. Staging: done (above).
2. Backup `before-migration-74 --full`, apply alone with its `_migrations` row, read-only checks, `verify.mjs --live`.
3. Merge after 2b's PR.

## Next

- **2d:** events and organizations by `university_id` (`events_console_*`), the portal's campus-admin shell (their
  navigation, the moderation and users pages for a campus admin, actions gated by permission), and the owners' screens
  to appoint campus admins and their campuses.

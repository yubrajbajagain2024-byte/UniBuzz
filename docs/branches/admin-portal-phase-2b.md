# admin-portal-phase-2b

- **Owner:** Sunil. **As of 2026-11-26:** branched from `admin-portal-phase-2` (2a, PR #129, migration 72) at `79aa97e`,
  stacked on it because 73 needs 72. Draft **PR #130** (base `admin-portal-phase-2`). Written by an AI session.
- **Purpose:** Phase 2b of the **UniBuzz Master Admin Portal** roadmap ([../status.md](../status.md); 2a in
  [admin-portal-phase-2.md](admin-portal-phase-2.md)): the first area scoped by campus, moderation. Campus admins get
  `moderation.view`, and the functions behind the portal's Reports and Flagged pages, and the content those pages act
  on, answer a campus admin for their own campuses only.

## What 2b changes

- **Migration 73** (`supabase/migrations/20261128000000_campus_moderation.sql`; rollback in `supabase/rollbacks/`):
  - `staff_role_permissions('campus_admin')` = `{moderation.view}`.
  - `staff_content_university(type, id)` (internal): the campus content belongs to is **its author's verified campus**
    (`verified_university()`, the confirmed email's domain; never a business account), the author as Trust & Safety
    finds them (`ts_author_of()`: anonymous listing posters and Buzz writers included, never shown). Not the row's own
    `university_id` nor the profile's: the apps set those and a student can change them (only campus-only posts are
    checked), so a student could move their own content into or out of a campus admin's reach. Private messages,
    stories and anything gone belong to no campus. `staff_campus_ids(user)` (internal).
  - On CampConnect Admin's schema: `staff_require_area(permission, min_role)` (internal; `staff_require()` word for word
    for everyone but a campus admin, who passes only at moderator level with the permission, a campus, no suspension and
    the second factor), called by ten functions that now scope by the content's campus: `admin_reports_list`,
    `admin_report_get`, `admin_report_resolve`, `admin_report_reopen`, `admin_auto_hidden_list`,
    `admin_auto_hidden_counts`, `admin_auto_hide_uphold`, `admin_content_get`, `admin_content_hide`,
    `admin_content_restore`. Out of scope is "not found". A reporter's email is shown to a campus admin only for their
    own verified students. Within a campus a campus admin is a moderator: escalated and legal-hold items stay with
    admins, deleting stays admin-only.
  - Owners, admins and moderators: every answer unchanged (the suite compares them row for row before and after).
- **Still refused to campus admins:** appeals (Trust & Safety's `console_appeals`/`console_decide_appeal`, which decide
  sanctions: 2c scopes them with users by the student's verified university), users, the queue, events, every other
  area. Nobody can be appointed yet (72), and the portal still sends a campus admin to `/no-access` (its shell is 2d).
- **The portal:** `lib/permissions.ts` names the campus admin's list (`CAMPUS_ADMIN`) for the drift test; nothing else.

## Tests (2026-11-26, on this branch)

- `supabase/tests/campus-moderation.test.mjs`: 58 checks, production's order (the full matrix: platform staff
  unchanged, a campus admin's reports, flags and content in and out of scope, a student from elsewhere placing content
  on the campus or naming it on their profile, emails, a moderator's limits, no campus, no second factor, suspended,
  every other area refused, two campuses, the helpers closed, grants kept, every type's campus, the rollback word for
  word via `pg_get_functiondef`, a second apply) and this repo's order (the table and helpers). Mutation-checked: a
  missing list filter, scoping by the row's own `university_id`, and a missing check on hide each fail it.
- 73 in the five rollout suites' `AHEAD` lists; `npm run check` passes; `db:test` 69 suites, 2550 checks, 0 failures
  ([../testing.md](../testing.md)).
- `supabase/tests/staging/campus-moderation.mjs` written, **not run yet** (needs `SUPABASE_ACCESS_TOKEN` and
  `STAGING_SUPABASE_REF` from the owner; needs 72 on staging, which it is).

## Rollout (after 72 is live, and waits on the owner)

1. Staging: `staging/campus-moderation.mjs` (applies 73 there, rolls it back, applies it again).
2. Backup: `node scripts/backup.mjs before-migration-73 --full`.
3. Apply 73 alone in one transaction with its `_migrations` row, then `notify pgrst, 'reload schema'` (owner's approval).
4. Verify (read-only): the ten functions' grants, the helpers closed, `staff_role_permissions('campus_admin')`, a
   profile's university still embeddable, `verify.mjs --live`.
5. Merge the PR after 2a's.
- **Rollback:** the rollback file with its `_migrations` delete; nothing is refused (campus admins only lose 73's powers).

## Next

- **2c:** users, sanctions and appeals by the student's verified university (`admin_users_list`, `admin_user_get`,
  `admin_user_search`, suspensions, `console_appeals`, `console_decide_appeal`), adding `users.view`.
- **2d:** events and organizations by `university_id`, the portal's campus-admin shell, and the owners' screens to
  appoint campus admins and their campuses.

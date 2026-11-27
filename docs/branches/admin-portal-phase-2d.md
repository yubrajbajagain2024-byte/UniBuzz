# admin-portal-phase-2d

- **Owner:** Sunil. **As of 2026-11-27:** branched from `admin-portal-phase-2c` (2c, PR #132, migration 74), stacked on
  it because 75 needs 74. Written by an AI session.
- **Purpose:** Phase 2d of the **UniBuzz Master Admin Portal** roadmap ([../status.md](../status.md); 2c in
  [../history.md](../history.md)): the last area a campus admin needs, the Events page (their
  campus's calendar) and the Content page (hidden content), so every permission they hold is scoped in SQL. After it
  comes 2e: the portal's campus-admin shell and the owners' screens to appoint campus admins.

## What 2d changes

- **Migration 75** (`supabase/migrations/20261130000000_campus_events.sql`; rollback in `supabase/rollbacks/`):
  - `staff_role_permissions('campus_admin')` = `{moderation.view, users.view, content.view, security.self}`: the last
    is the portal's Security page for their own account (the second factor every scoped function asks for, their
    password), found while planning 2e: without it a campus admin could never pass the second factor in the portal.
  - Events and organizations belong to **the campus whose calendar shows them**, their own `university_id` (an
    organization's from its creator's profile, an event's from its organization or feed, a feed's from the admin who
    added it). Unlike a student's content (73: the author's verified campus) this is where the row appears, which is
    what a campus admin governs. The console shows only public details about people (a creator's username).
    `events_console_events`, `_counts`, `_feeds`, `_organizations`, `_set_event`, `_set_organization` call
    `ts_require_area('content.view')`: a campus admin sees and changes only their campuses' rows (others "not found"),
    recorded as `campus_admin`. Saving and deleting a feed stay admin-only (`ts_require_admin`).
  - CampConnect Admin's `admin_hidden_content_list` on `staff_require_area('content.view')`, each row's campus by
    `staff_content_university()` (73 and 74: the author's verified campus; staff, messages and stories: none).
  - Owners, admins and moderators: every answer unchanged (the suite compares them whole).
- **The portal:** `lib/permissions.ts` `CAMPUS_ADMIN` adds `content.view` (75 is the newest scoping migration, so its
  suite compares it); 74's suites now check 74's own set.

## Tests (2026-11-27, on this branch)

- `supabase/tests/campus-events.test.mjs`: 41 checks, production's order (events, organizations, feeds, counts, the
  content browser, before and after for the platform's staff, verify and hide in and out of scope, feeds admin-only, no
  campus, no second factor, every other area refused, the rollback word for word) and this repo's order (the events
  console, the rollback). Mutation-checked: the events list without its scope, verifying without the campus check, and
  the content browser without its scope each fail it.
- `npm run check` passes; `db:test` 71 suites, 2659 checks, 0 failures ([../testing.md](../testing.md)); the new suite 41.
- Staging: `supabase/tests/staging/campus-events.mjs` **14/14** (run `mwy9h6k0`, 2026-11-27): each campus's calendar
  and hidden content (a throwaway sign-up domain, removed after), the platform's answers unchanged, the campus admin's
  events, organizations, feeds and hidden content in and out of scope, verify and hide recorded as campus_admin, feeds
  admin-only, a profile's university embeddable; rolled back and applied again, so **75 is on staging**. Every table's
  row count as at the start (10 log rows stay, append-only).

## Rollout (after 74; each step waits on the owner)

1. Staging: done (above).
2. Backup `before-migration-75 --full`, apply alone with its `_migrations` row, read-only checks, `verify.mjs --live`.
3. Merge after 2c's PR.

## Next (2e)

- The portal's campus-admin shell: `getStaffAccess` and `requireStaff`/`requireStaffAction` accept a campus admin and
  gate them by permission alone (never by rank); a landing page for a role without `dashboard.view`; their campuses in
  the header; the role badge; every action they can reach gated by its permission.
- Appointing: owners invite a campus admin with their campuses, change an existing member's role and campuses, and see
  them on the team list (SQL: `admin_staff_add`, `admin_staff_set_role`, invitations and the email claim carrying the
  campuses; audited), with a migration of its own.

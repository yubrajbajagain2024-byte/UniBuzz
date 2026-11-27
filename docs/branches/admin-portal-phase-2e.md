# admin-portal-phase-2e

- **Owner:** Sunil. **As of 2026-11-27:** branched from `admin-portal-phase-2d` (2d, PR #133, migration 75), stacked on
  it because 76 needs 75 and the portal's campus-admin view needs every scoped area (73 to 75). Written by an AI session.
- **Purpose:** Phase 2e of the **UniBuzz Master Admin Portal** roadmap ([../status.md](../status.md)), the last layer of
  Phase 2: the portal's Campus Admin dashboard and permission-based navigation, and owners appointing campus admins
  with their campuses (assignment, invitation and appointment).

## What 2e changes

- **Migration 76** (`supabase/migrations/20261201000000_campus_appointments.sql`; rollback in `supabase/rollbacks/`):
  - `staff_role_permissions('campus_admin')` adds `campus.overview` (their dashboard; nobody else has it).
  - `staff_invites.university_ids`: the campuses an invitation to the role carries.
  - `staff_campuses_follow_role` (on CampConnect Admin's `staff` and migration 41's `staff_members`): leaving the role
    or the staff list deletes a person's campuses.
  - `admin_campus_admin_add(email, universities)` (**owners**, second factor): an existing confirmed account joins at once
    with its campuses; anyone else gets an invitation carrying them (migration 18's email, binding and expiry). 1 to 20
    existing universities; never yourself or someone already on the staff. `admin_campus_admin_set_campuses()` (owners).
    `admin_staff_campuses()` (the staff list's readers; invitations, which name an email address, for owners and admins
    only, as `admin_invites_list()` rules: found in review before production, fixed and re-rehearsed). Every change in
    `staff_audit_log` with the universities.
  - `staff_invite_for_caller()` (resend, the email's result, withdraw): campus admin invitations are the owners' alone.
    `staff_claim_invite()`: claimed only while the inviter is still an owner, bringing the campuses.
  - Unchanged: `admin_staff_add` and `admin_staff_set_role` still refuse the role; admins may still remove a campus admin
    or change them to another role they can grant (taking access away, or what an admin gives anyone).
- **The portal (apps/admin) and `packages/shared`:**
  - `StaffListRole` (every role on the staff list) beside `AdminStaffRole` (the three ranked ones); `isPlatformRole`,
    `STAFF_ROLE_LABELS`, `CAMPUS_ADMIN_ROLE`; `canAssignRole`/`canChangeMember` follow the SQL rules (owners appoint
    campus admins; admins may change or remove them); `appointCampusAdmin`, `setCampusAdminCampuses`,
    `getStaffCampuses`. (Trust & Safety's own `StaffRole` is a different type and keeps its name.)
  - `lib/admin.ts`: a campus admin is let in **by permission alone, never by rank**: `hasRole` is never true for them, a
    page or an action that names no permission refuses them (default deny), a refused page sends them to the first
    section they may open (`homeFor`, never a loop); the layout's `shell` lets any staff member see the frame.
    `getMyCampuses()` for the header and the dashboard. `canModerateUser` follows 74 (campus admins never act on staff;
    only owners and admins on a campus admin).
  - Every server action names its permission (moderation, users, content, operations, the caller's own security) or a
    minimum role, so none is open to a campus admin by default.
  - Navigation: a "My campus" section at `/` (`campus.overview`); the Users section's Staff accounts tab needs
    `staff.view`. `/` shows a campus admin their **Campus Admin dashboard** (`components/overview/campus-overview.tsx`):
    open reports, flags waiting, open appeals, organizations to verify, upcoming events, suspended students and the
    latest open reports, every number from a scoped function. The header shows their campuses beside the role badge.
  - Staff page: owners see **Appoint a campus admin** (email and campuses); each campus admin's campuses on the team
    list, changed by owners in place; campus admin invitations show their campuses. Roles legend and badges know the
    role.

## Tests (2026-11-27, on this branch)

- `supabase/tests/campus-appointments.test.mjs`: 41 checks (production's order: appointing existing and invited people,
  claims, an inviter no longer an owner, owners-only management of the invitations, campuses changed, campuses going
  with the role, every refusal, the helpers closed, grants, the rollback refused while an invitation is pending then
  word for word; this repo's order: the table, the trigger on `staff_members`, the rollback). Mutation-checked: admins
  allowed to appoint, admins allowed to resend a campus admin invitation, and a claim without the owner check each fail it.
- `packages/shared/tests/staff-roles.test.mjs` (5): the role helpers.
- 75's suites now check 75's own set (76 is the newest to change the table).
- `npm run check` passes; `test:shared` 321/321; `db:test` 72 suites, 2700 checks, 0 failures
  ([../testing.md](../testing.md)).
- Staging: `supabase/tests/staging/campus-appointments.mjs` **12/12** (run `mwyar4ku`, 2026-11-27), and again after the
  invitation fix (run `mwybdf4y`, 12/12, with a moderator now seeing no invitation), so **76 is on staging**. A first run (`mwyao5x7`) passed its 11 checks but stopped in cleanup: staging keeps no owner of its own, so
  the run's throwaway owner was the last one and the last-owner guard refused its removal; its rows were removed by hand
  with the guard set aside for that one delete, the cleanup now does the same, and 76 was rolled back and rehearsed
  again.
- Browser, the portal's dev server against staging, in Chrome: `apps/admin/e2e/campus-admin.mjs` **8/8** as the staging
  campus admin (`supabase/tests/staging/campus-e2e-account.mjs`; its keys in a git-ignored state file): the second
  factor first, the campus overview at `/` with their campus, the header's role and campus, the sidebar exactly My
  campus, Users, Moderation, Content, every permitted page rendering, their Security page, every other page (staff,
  audit, analytics, business, universities, settings, media, operations, support) sending them back to their overview,
  no console error or CSP violation. `apps/admin/e2e/admin.mjs` passes as the staging admin and as the moderator
  (every section, the audit log's rules, owner and admin sections, no browser errors): the platform's staff unchanged.

## Rollout (after 75; each step waits on the owner)

1. Staging: done (above).
2. Backup, apply 76 alone with its `_migrations` row, read-only checks, `verify.mjs --live`.
3. Merge after 2d's PR (the portal's campus-admin view needs 73 to 76 live).

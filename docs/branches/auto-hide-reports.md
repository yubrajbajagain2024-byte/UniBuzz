# auto-hide-reports

- **Owner:** Yubraj. **As of 2026-11-03:** branched from `main` at `188c918` (2026-10-28); `main` merged in at
  `f77d796` (PR #52) and at `753ab56` (PR #92, after the Business v2 release). Pushed; **PR #53 open**, not merged.
  Written by an AI session.
- **Purpose:** content that 10 different legitimate people report is hidden at once on the website
  and the app, flagged for review in CampConnect Admin, its owner told and the action audited. Admins
  restore, keep hidden or delete. A restore needs 10 new reporters to hide it again. Buzz stays anonymous.
- **Owner's decisions (2026-10-28):**
  - 10 is a backstop on top of Trust & Safety's thresholds, which still hide Buzz at a weighted 3.
  - Covered: posts, reels, comments, apartments, roommate posts, Marketplace items, Buzz threads and
    replies. Not covered: profiles, messages and stories.
  - After a restore only new reports count.

## Done

- Migration 64, `20261116000000_report_auto_hide.sql`, with its rollback (README §"Hidden at 10 reports";
  docs/migrations.md). It was 57 as `20261110000000_…` until `main` took that timestamp for the business hours
  (PR #59); renamed 2026-11-03 to follow 63, the last migration live on production.
- **2026-11-03, after merging `main`:** migration 62 (story actions, live since 2026-11-02) had replaced
  `ts_snapshot()` and `ts_set_content_status()` with story-aware versions. This migration replaces both again, so its
  versions, and the rollback's, now keep 62's story branches (a story's snapshot from `ts_story_snapshot()`; a removed
  story deleted). Without that, applying 64 would have broken story reports.
- The PGlite suite `supabase/tests/report-auto-hide.test.mjs`, in `db:test`, runs the migration on production's
  schema in full, on production as it is today (nothing left out any more: every migration up to 63 is live), and on
  this repo's schema alone. The rollout rehearsal (`production-rollout.test.mjs`) ends with 64.
- The console's limitation note U1 is updated.
- The CampConnect Admin review screens (the Flagged page, the "Hidden automatically" panel, the overview count, the
  nav entry, the audit labels) are on `main` already, from `admin-analytics-business`. They read
  `admin_auto_hidden_list(status, limit, before, target_type, target_id)` and show "Database update needed" until
  the migration is live. That notice is what the owner sees on the deployed admin app today.
- Fixes from the independent review of 2026-10-28 (commit `7c45258`): a review closes only the reports that count;
  restore and keep hidden follow the console's reviewer rule; the console's approve, restore and granted appeals
  un-hide public content only where reports hid it; staff-approved content is never auto-hidden; the rollback has no
  `begin`/`commit` of its own.

## Tests

2026-11-03, with `main` at `753ab56` merged in (docs/testing.md): `npm run db:test` 59 suites, 1720 checks,
0 failures (`report-auto-hide` 100, with the new story check); `npm run check` 9/9; `test:shared` 295/295.

- Not run: anything against a real Supabase project (no token in this session's environment).

## Read paths checked (2026-10-28, production's schema in PGlite)

- Every permissive select policy on `feed_posts`, `post_comments`, `apartments`, `items` and
  `roommate_posts` applies `content_visible()`; the owner-only anonymous-listing policies are correct.
- `reels_feed` and Discover's reads (`security invoker`, joined to `feed_posts`) follow those policies.
- No views. No `security definer` function a student can call returns these rows' content.
- **One gap, not fixed here:** `ads_for_feed()` (migration 50, live since 2026-11-03) shows a promoted
  apartment's title and photos without checking `hidden_at`. Fix it in a later migration.

## Pending

- [ ] Owner's approval, then apply 64 alone on production: `scripts/backup.mjs before-migration-64 --full`, a
      read-only `verify.mjs --live` (production should match the repo exactly), the file as one transaction with
      its `_migrations` row, `notify pgrst, 'reload schema'`; check `report_auto_hides`, the triggers and the
      `admin_auto_*` functions after; record it in docs/migrations.md.
- [ ] Merge PR #53 (every push to `main` deploys both apps). The Flagged notice disappears as soon as the
      migration is live, since the screens are already deployed.
- [ ] Afterwards: an owner is not told when upheld content is later restored; the schema guard still checks only
      `staff_audit_log`; the delete log still names a Buzz author (CampConnect Admin's existing behaviour).

# auto-hide-reports

- **Owner:** Yubraj. **As of 2026-10-28:** branched from `main` at `188c918`; `main` at `0d8e459`, then at `f77d796` (PR #52: Business v2 fixes to 55 and 56), merged in. Pushed; PR into `main`, not merged.
  Written by an AI session.
- **Purpose:** content that 10 different legitimate people report is hidden at once on the website
  and the app, flagged for review in CampConnect Admin, its owner told and the action audited. Admins
  restore, keep hidden or delete. A restore needs 10 new reporters to hide it again. Buzz stays anonymous.
- **Owner's decisions (2026-10-28):**
  - 10 is a backstop on top of Trust & Safety's thresholds, which still hide Buzz at a weighted 3.
  - Covered: posts, reels, comments, apartments, roommate posts, Marketplace items, Buzz threads and
    replies. Not covered: profiles and messages.
  - After a restore only new reports count.
  - Two branches: the database, website and app here; CampConnect Admin's review screens on `step-admin`.

## Done

- Migration 57, `20261110000000_report_auto_hide.sql` (first written as `20261109000000_…`, renamed when `main` took that timestamp), with its rollback (README §"Buzz (anonymous)",
  "Hidden at 10 reports"; docs/migrations.md).
- PGlite suite `supabase/tests/report-auto-hide.test.mjs`, added to `db:test`. It runs:
  - production's schema in full;
  - production as it is today (the migrations not live yet left out);
  - this repo's schema alone, where nothing changes.
- `harness.mjs` gained `boot({ skip })`.
- The console's limitation note U1 is updated.
- **Fixes from an independent review (2026-10-28, local commit, not pushed):**
  - A review closes only the reports that count: never a self-harm report, nor a queue item on legal hold or about
    someone's wellbeing; an escalated item only when an admin acts (`report_auto_hide_close`, new
    `report_auto_hide_close_reports`).
  - Restore and keep hidden follow the console's reviewer rule: not by someone who wrote or reported the content, and
    not by a moderator on an escalated or legal-hold item (new `report_auto_hide_assert_reviewer`).
  - The console's approve, restore and granted appeals un-hide public content only where reports hid it, never a hide
    staff made by hand, and write CampConnect Admin's audit log (`ts_set_content_status`, new `report_hidden_reason`).
  - Staff-approved content (`autoHideImmune`) is never auto-hidden; only a Buzz Trust & Safety hid is flagged as
    its own; the auto-hide log takes the author from CampConnect Admin's snapshot, so it never names an anonymous
    listing's poster; the reporter count runs only when it is needed.
  - The rollback has no `begin`/`commit` of its own; the repo-schema check uses the real five-argument signature.
  - Not done (the review's info notes): the schema guard still checks only `staff_audit_log`; the delete log still
    names a Buzz author (CampConnect Admin's existing behaviour); an owner is not told when upheld content is later
    restored.

## Tests (2026-10-28)

- `npm run db:test`: 42 suites, 1623 checks, 0 failures, with the review's fixes (1607 before them, after merging `main` at `f77d796`; 1583 at `0d8e459`).
  The production rollout rehearsal now applies, rolls back and re-applies 57 with the other pending migrations. That includes Trust & Safety, Buzz v2 and
  CampConnect Admin + Buzz, unchanged.
- `report-auto-hide`: 99 checks (83 before the review's fixes). Each fix has a check that fails on the earlier migration (run against it on 2026-10-28).
- `npm run check`: 6/6 (again with the review's fixes). `test:shared` 184/184, `test:moderation` 429/429 (after merging `f77d796`).
- 57 shares no function, policy, trigger or view with 49 to 56, so running after Business v2 changes none of it.
- Not run: anything against a real Supabase project. step-admin's own admin suites do not run on
  `main`'s schema: they predate Trust & Safety, whose report trigger refuses some of their fixtures.
  That is part of the pending step-admin merge.

## Read paths checked (2026-10-28, production's schema in PGlite)

- Every permissive select policy on `feed_posts`, `post_comments`, `apartments`, `items` and
  `roommate_posts` applies `content_visible()`; the owner-only anonymous-listing policies are correct.
- `reels_feed` and Discover's reads (`security invoker`, joined to `feed_posts`) follow those policies.
- No views. No `security definer` function a student can call returns these rows' content.
- **One gap, not fixed here:** `ads_for_feed()` (migration 50, not live) shows a promoted apartment's
  title and photos without checking `hidden_at`. Fix it in a migration after 50 is live. The owner is
  Sunil's `business-v2` line.

## Pending

- [x] The CampConnect Admin review screens: `step-admin` commit `1a0968e`, local, not pushed.
  - A Flagged page with tabs per review status and counts.
  - A "Hidden automatically" panel with Keep hidden on the content page.
  - The overview count, the nav entry, the `actioned` badge and the audit labels.
  - It reads `admin_auto_hidden_list(status, limit, before, target_type, target_id)` and shows a setup notice
    until this migration is live.
  - Checked: tsc, eslint, next build and the signed-out e2e. Signed-in pages are untested (no staff
    credentials on the owner's Mac).
- [ ] Before production: read production's `admin_content_*` bodies, and run
      `verify.mjs --live` (needs a token).
- [ ] Owner's approval, then: apply 57 alone, merge this branch's PR, deploy the admin app.

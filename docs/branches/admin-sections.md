# admin-sections

- **Owner:** Yubraj. **As of 2026-11-03:** branched from `main` at `4dc6489`. Written by an AI session.
- **Purpose:** CampConnect Admin's sidebar becomes nine sections with the stated pages (the owner's sketch of
  2026-11-03): Dashboard; Users; Moderation; Content; Business & Ads; Analytics; Operations; Support; Administration.
  How they map to routes and functions: docs/technical-reference.md, "CampConnect Admin: sections".

## Done

- `lib/sections.ts` (the model), the sidebar with titles and descriptions, `SectionTabs` on every page of a section.
- New pages: Appeals (ported from the website's console, through the same `console_*` functions), Events (hide,
  cancel, restore), System health, Email, Support requests (organizations awaiting verification), Issues, Settings
  (rule packs, sign-up domains). The dashboard gains Alerts and Pending decisions; Users gains Verification.
- Migration 65, `20261117000000_console_health.sql`, with its rollback and `tests/console-health.test.mjs`; the
  rollout rehearsal ends with it.
- The browser check lists the new pages (signed out: all go to login; signed in: every page renders).

## Not done / decisions taken

- There is no ticket system: "user requests" are what the data already holds (organizations, businesses, appeals), and
  "issues" are failing jobs and feeds. A support inbox for students would be a product feature across the apps.
- Analytics keeps its three views (Platform covers growth and engagement). Business & Ads keeps its own tabs.
- Calendar feeds are still added and edited in the website's staff console only.
- Not run: the browser check against a real project (no staff credentials in this session).

## Pending

- [ ] `npm run check`, `npm run db:test`, docs/testing.md; PR, merge.
- [ ] Owner's approval, then apply 65 alone on production (full backup, `verify.mjs --live`, one transaction with its
      `_migrations` row, `notify pgrst`), and record it in docs/migrations.md.

# admin-portal-phase-1

- **Owner:** Sunil. **As of 2026-11-26:** branched from `main` at `a0a1a9f` (PR #126); **PR #127**, to be merged after 71 is
  live on production (the owner's approval). Written by an AI session.
- **Purpose:** Phase 1 of the **UniBuzz Master Admin Portal** roadmap (the owner's approval of 2026-11-25; roadmap in
  [../status.md](../status.md), decisions in [../decisions.md](../decisions.md)): the portal's name on screen, one audit
  view over the three audit logs with where staff actions came from, a Content-Security-Policy, and navigation driven
  by permissions. No security weakness is involved, so the branch is pushed as it goes.

## What it changes

- **Migration 71** (`supabase/migrations/20261126000000_audit_feed.sql`; rollback in `supabase/rollbacks/`):
  - `audit_request_context`, closed to the API, filled by after-insert triggers on `staff_audit_log`, `audit_log` and
    `business_audit_log`, only for a row whose actor is on the staff and acting in their own API request: the address
    and browser the API gateway saw (PostgREST's `request.headers`), the address, browser and page the portal's server
    reports (`x-portal-client-ip`, `x-portal-user-agent`, `x-portal-path`), the endpoint (`request.path`), the session id
    and its assurance level. Never for students (an appeal is logged with no actor during the student's own request),
    business teams (`actor_kind = 'team'`), the system, someone else's request or SQL outside the API. Values are
    cleaned (no control characters, cut), an address kept only if it is made of an address's characters; cookies and
    the bearer token are never read. Best effort: a failure never blocks the action audited.
  - `console_audit_feed(p_filters, p_limit)`: staff with a second factor (`ts_require_staff`); the three logs merged
    newest first, 50 a page (at most 100), a keyset cursor (`<µs since the epoch>-<log>-<id>`); filters by log, person,
    action (exact, or a prefix ending with "."), target, business and dates. Moderators keep each log's own rules (the
    team's log: their rows and moderation activity, a deleted Buzz thread's snapshot without its author; Trust &
    Safety's: their own rows, never a user tied to an anonymous Buzz item; no business entries) and never see the
    context. Owners and admins see everything.
  - Indexes `staff_audit_log (created_at desc, id desc)` and `business_audit_log (created_at desc, id desc)`.
  - The rollback drops the feed, the triggers and the helpers, and **keeps** `audit_request_context` and its rows
    (they are part of the record; dropping them is the owner's separate decision).
- **The portal (apps/admin):**
  - **Name:** "UniBuzz Master Admin Portal" (`lib/brand.ts`): titles, login, the header ("UniBuzz" over "Master Admin
    Portal"), invitations' page, no-access. The website's staff two-factor page and two messages name it too. The
    identifiers keep their names (root CLAUDE.md's rule changed in this PR).
  - **Audit log** (`/audit`): the feed, with log pills (Everything, Team, Trust & Safety, Business for owners and
    admins), a filter form (action with suggestions, dates in UTC), links that filter by person, target and business,
    "Older entries" by cursor, and for owners and admins a "Request" disclosure on staff entries (the browser's
    address as the portal reported it, the address the API saw, browser, page, API call, session). Rendered on the
    server, no client JavaScript. Without migration 71 the page shows the team's log as before, with a setup notice.
  - **Request context:** the server Supabase client sends `x-portal-*` headers (`lib/request-context.ts`) from Vercel's
    `x-real-ip` / `x-forwarded-for` and the browser's user agent; the proxy sets `x-portal-path` (replacing any the
    browser sent).
  - **Content-Security-Policy** (`lib/csp.ts`, set in `proxy.ts` on every response): a fresh nonce per response with
    `'strict-dynamic'`, no inline scripts or eval (dev adds eval for React's tooling), inline styles allowed (two charts),
    images from the app, data:, blob:, Supabase, Mux and Google avatars; connections to the app and the Supabase project;
    forms to the app, Supabase Auth and Google; no framing, plugins or `<base>`; `upgrade-insecure-requests` on https. The
    root layout awaits `connection()` so every page (the 404 included) renders per request and gets the nonce.
    `instrumentation-client.ts` runs zod jitless (zod 4 otherwise tests `new Function` on load: a violation on every page).
  - **Permissions** (`lib/permissions.ts`): one table, default deny, read by the sidebar, the section tabs (through a
    `PermissionsProvider` in the shell; the pages no longer pass `admin`) and every page's `requireStaff(…, { permission })`.
    The same access as before for owners, admins and moderators; Phase 2 moves the table into SQL (`staff_can()`).
- `packages/shared`: `auditFeedActionLabel()` and `humanizeAuditAction()` (Trust & Safety's actions in plain words), the
  `console_audit_feed` type.

## Tests (2026-11-26, on this branch)

- `supabase/tests/audit-feed.test.mjs`: 62 checks (30 in this repo's order, 32 in production's), in `db:test`; 71 is in
  the five rollout suites' `AHEAD` lists.
- `apps/admin/e2e/admin.mjs` learned the new name, the CSP (header parts, a nonce that changes, every script tag
  carrying it, hydration, a redirect with the policy, any `securitypolicyviolation` counted as a browser error) and the
  audit log for each role. Signed out against a local production build: all checks pass, no violation.
- `npm run check` (typecheck, lint, build: 9 tasks), `npm run test:shared` 316/316, `npm run db:test` 67 suites, 2412
  checks, 0 failures: all pass (2026-11-26, [../testing.md](../testing.md)). The browser check found zod 4 testing
  `new Function` on every page under the new CSP; fixed (zod runs jitless in the browser).
- **Staging, 2026-11-26:** `supabase/tests/staging/audit-feed.mjs` 14/14 (run `mwxz13dl`): 71 alone, the gateway's view
  (one IPv4 hop) and the portal's `x-portal-*` headers recorded, the feed per role, 50 entries in 239 ms, the rollback and
  71 again: **71 is on staging**. `apps/admin/e2e/admin.mjs` passes as the staff admin and the staff moderator against a
  local production build pointed at staging, with the CSP enforced and no violation. A one-off check through the same
  build: a request declined in `/universities` carried the browser's page, browser and address to the database, and
  `/audit` showed them. Fixed on the way: `upgrade-insecure-requests` now follows the portal's own scheme (on a laptop's
  http it sent every request to https://localhost); the team's university entries name the university and the reply,
  and Trust & Safety's entries read their target in words ("Rule pack baseline · turned on").
- PR #127's Vercel previews built; the portal's preview is behind Vercel's protection, so its CSP was not fetched there
  (`vercel curl` would add a protection bypass to the project's settings). The portal loads no Vercel scripts.

## Rollout (step 1 done 2026-11-26; the rest waits on the owner)

1. **Staging (done):** `supabase/tests/staging/audit-feed.mjs` (applies 71 alone, checks it through Auth and the REST API,
   rolls it back, applies it again), then the portal's browser check as the staging admin and moderator against a local
   production build pointed at staging (its CSP included), and one decision made in `/universities` through the portal's
   own server whose request details `/audit` must show.
2. **Backup:** `node scripts/backup.mjs before-migration-71 --full` (the owner's Mac).
3. **Apply 71 alone** on production in one transaction with its `_migrations` row, then `notify pgrst, 'reload schema'`
   (with the owner's approval). Nothing changes for students or businesses; the old readers are untouched.
4. **Verify** (read-only): the triggers and grants, `verify.mjs --live`.
5. **Merge the PR** (deploys the portal with the CSP and the website's renamed strings), then a staff admin opens
   `/audit`; record 71 in docs/migrations.md and docs/history.md.
- **Rollback:** the rollback file with its `_migrations` delete; the portal's `/audit` falls back to the team's log.
  Merging before 71 is live is safe too (the page falls back), but the request context only starts with 71.

## Next

- Phase 2 on its own branch: campus scopes, the Campus Admin role, `staff_can()` in SQL, every staff function scoped.
- Later, with the owner: a retention limit for `audit_request_context` (a platform setting, Phase 8).

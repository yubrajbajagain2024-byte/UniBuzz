# History

How UniBuzz got here, dated. Sources: git history and commit messages; production events also from
the owner's deploy notes. Each migration's production date is in [migrations.md](migrations.md);
open work is in [status.md](status.md).

## Names

- **Apartment Book** (2026-09): an apartments, roommates, marketplace and chat site for Texas State
  students. The name survives in identifiers (root CLAUDE.md, "Legacy names stay").
- **CampConnect**: the product's name in its docs and website until 2026-10-26. The separate staff
  app keeps the name **CampConnect Admin**.
- 2026-10-20: the app was renamed **UniBuzz** and its For you tab **Orbit** (`cbaad1a`).
- 2026-10-26: **UniBuzz** everywhere (`5bf3035`, merged into `main` in `fee2e8f`).
- The GitHub repository was renamed from `Apartment-Book` to `UniBuzz` (noticed 2026-10-27; the old
  URL redirects).

## Timeline

- **2026-09-07:** first commits (Yubraj): "Apartment Book: apartments, roommates, marketplace and
  chat for Texas State students". `step-1-brand-shell`, a first brand-and-shell pass, is never
  merged ([branches/step-1-brand-shell.md](branches/step-1-brand-shell.md)).
- **2026-10-09 – 10-25:** `step-home-feed`, the main feature line, merges as PRs #1 – #32: home
  feed, profiles, comments, sharing, messages, course chats, Snaps, calls, push, profile privacy,
  Expo SDK 58.
- **2026-10-18:** a full redesign is tried and undone the same day (`a817832`, `4e9502f`); what
  stays is one sheet and button family, Apple's type scale and the Aurora palette (`a60f8d6`,
  `a1cedf4`).
- **2026-10-20:** Buzz v2 ported from UniVerse, with the moderation engine and a staff console
  (`03842fd`).
- **2026-10-25:** calls paused behind a flag (`e39fd3e`); the business portal and migrations 38–40
  reach production; CampConnect Admin's four admin migrations reach production from `step-admin`;
  PR #33 (`business-portal-prelaunch`), PR #35 (`ankur/dev`), PR #37 (`ankur/owner-moderation`:
  Buzz v2 and Trust & Safety).
- **2026-10-26:** migrations 41, 42 (Ankur) and 43 reach production; from then on every push to
  `main` deploys production; `business-portal-prelaunch` merged again
  (`fee2e8f`); Android release build fixed (`2e0e445`); a stray root `app.json` committed by
  accident (`b09910d`, [branches/business-portal-prelaunch.md](branches/business-portal-prelaunch.md));
  PR #38 (`ankur/dev`: Discover, Orbit "+", profile menu); PR #40 (`listing-flow-redesign`, with
  `create-flow-redesign`: the camera-first create flow, post details, anonymous listings).
- **2026-10-27:** migration 45 reaches production; PR #41 (`ankur/dev`: an emoji no
  longer holds a Buzz for review); PR #42 adds the root `CLAUDE.md`; PRs #43 and #44 are opened
  from two merged branches and conflict with `main`; PR #45 restructures the AI documentation into
  one shared `CLAUDE.md` plus `docs/`; PRs #46 and #47 are opened from two more merged branches.
- **2026-10-30:** migrations 58, 59 and 60 reach production on their own, ahead of the Business v2
  release (19:30, 20:30 and 21:46 UTC); PRs #69 to #73 merge (Stories, their media, the upload
  folders and the full backup, the business portal made instant).
- **2026-10-31:** branch `events`: the app's bar becomes Home, Explore, Messages, Events, Profile,
  and the Discover tab becomes the search screen behind a magnifier beside the bell; migration 61
  (Events) is written and applied on staging, not on production. PR #74 merges it at 03:43 UTC
  (deployed; 61 still not applied). Sunil and Ankur may merge their own pull requests from then on
  ([decisions.md](decisions.md)).
- **2026-11-01:** PRs #77 to #81 merge (the app's viewers, bottom bar, Home's top edge, Settings, Explore's and Events'
  filters); migration 61 (Events) reaches production on its own, ahead of the Business v2 release (23:31 UTC).
- **2026-11-03:** the Business v2 release reaches production (00:19 UTC): 44, 46, 49 to 57 and 63 in one `db:setup`
  run, after a full verified backup; CampConnect Admin's Analytics and Business work from then on.
- **2026-11-02:** migration 62 (story actions) reaches production on its own (04:32 UTC). PR #60 merges:
  CampConnect Admin (`apps/admin`, from `step-admin`) is on `main` with its Analytics and Business sections
  (migration 63, not on production) and the rest of `step-admin` outside its migration files.

## The AI documentation

- 2026-10-26: an AI session drafts a `CLAUDE.md` in the worktree branch
  `claude/claude-md-documentation-0b8750` (never committed).
- 2026-10-27: every branch gets a `CLAUDE.md` with shared sections and a branch-specific §9; `main`'s
  arrives in PR #42. Each branch's copy differs, so merges conflict (PRs #43 and #44). The same day
  it is replaced by one shared root `CLAUDE.md` on `main`, folder files in `apps/mobile/` and
  `supabase/`, and these docs ([decisions.md](decisions.md), last row): PR #45, merged without a
  formal GitHub review (an independent AI review ran before it was pushed, and its findings were
  fixed). PRs #46 and #47 are then opened from two more merged branches; like #43 and #44 they carry
  only old copies (and, in #47, the stray `app.json`).

- 2026-10-28 04:07 UTC: PR #49 (UniBuzz Business v2) merged into `main`, 16 seconds after it was
  opened. Its description and this repository's docs said to apply migrations 49 and 50 first.
  Production's website therefore runs Business v2 code against a database without them (see
  status.md). The follow-up work (migration 51, now 55; video routes; review fixes) stays on
  `business-v2` for a new PR.

- 2026-10-28 19:03 UTC: PR #52 (`business-v2`'s third and fourth rounds: the fixes to 50, 55 and 56,
  the staging rehearsal and backup tooling, the production checklist) merged into `main`. None of
  49 to 56 is on production.

- 2026-11-02 05:28 UTC: PR #86 (`story-viewer-redesign`) merged into `main` by the owner: the story viewer redesigned.
  App only; the website's production deployment from it is Ready (its pages answer 200); testers get it with an EAS update.

- 2026-11-02: PR #60 (`admin-analytics-business`) merged into `main` with the owner's approval ("merge it if everything
  is good"): CampConnect Admin and its Analytics and Business sections, `step-admin`'s tooling, suites and README
  section, the staging scripts' two-factor sign-in. Migration 63 is not on production; the `campconnect-admin` Vercel
  project is still disconnected, so the merge deployed the website only (two messages changed there). The branch's
  file stays until the launch plan in it is carried out.
  The same day, with the owner's approval, the `campconnect-admin` Vercel project was disconnected from the repository: it
  builds `apps/admin`, which only `step-admin` has, so every other push failed there (docs/decisions.md).

- 2026-11-02: the `campconnect-admin` Vercel project reconnected to the repository (`vercel git connect`, with the
  owner's "reconnect and merge everything"), now that `apps/admin` is on `main`; its first deployment from `main` comes with PR #91
  (`admin-vercel-git`, the deploy rule and docs; a git-based ignore command was tried and dropped: `.vercelignore` strips `.git`).

- 2026-11-02 04:32 UTC: migration 62 (story actions) applied to production on its own, with the owner's approval,
  after staging (04:02 UTC, `staging/story-actions.mjs` 15/15) and a full backup checked against the live project
  (`before-migration-62`); one transaction through the Management API, its `_migrations` row with it; every check
  after passed ([migrations.md](migrations.md)). Story likes, replies and shares stop failing on production.

- 2026-11-02 03:57 UTC: PR #84 (`ankur/dev`) merged into `main` by Ankur: the offline rehearsal for Discover (44, 46)
  and Buzz (51 to 54) going live ahead of the release in two transactions, and PR #54's fix to 53 (a typed title stays).
  None of the six is on production. Its rehearsal starts from a production with 62 since `story-actions-fix` merged
  `main` in.

- 2026-11-01 23:48 UTC: PR #82 (`migration-61-live`) merged into `main` by the owner: migration 61 recorded as live, and
  the rollout rehearsals starting from a production that has it. Docs and tests only.

- 2026-11-01 23:31 UTC: migration 61 (Events) applied to production on its own, with the owner's approval, after its
  staging probe (13/13) and a full backup checked against the live project (`before-migration-61`); one transaction
  through the Management API, its `_migrations` row with it; every check after passed ([migrations.md](migrations.md)).
  From then on the app's Events writes (interests, saves, follows) work against production.

- 2026-11-01 23:18 UTC: PR #81 (`discovery-redesign`) merged into `main` by the owner: Explore's and Events' search and
  filters in three levels, Events' readable error before 61, a steady Profile grid. App only; the website redeployed
  without a change of its own; testers get it with an EAS update (owner's approval).

- 2026-11-01 20:18 UTC: PR #80 (`settings-redesign`, the owner's commit "Update UniBuzz features and UI") merged into
  `main` by the owner: the app's Settings as a menu of sections, each its own screen. App only; the website redeployed
  without a change of its own; testers get it with an EAS update (owner's approval).

- 2026-11-01 19:52 – 19:53 UTC: PRs #77 (`viewer-full-bleed`), #78 (`nav-velocity-collapse`) and #79
  (`home-full-bleed-top`) merged into `main` in that order by the owner: the app's viewers from the top edge over a
  blurred copy, the bottom bar collapsing by the speed of a scroll, and Home's feeds under the status bar. App only; the
  website redeployed without a change of its own; testers get them with an EAS update (owner's approval).

- 2026-10-30 21:46 UTC: **migration 60 (every upload folder its owner's to list; a post's photos from and with the
  post) applied to production on its own**, after 58 and 59, with the owner's approval: the first full backup
  (`2026-10-30-before-migration-60`: rows, accounts with their password hashes, 101 files, restorable with
  `scripts/restore.mjs`) and a read-only `verify.mjs --live` first. Signed out, listing any folder of the uploads bucket
  now returns nothing; public addresses still serve. The restore tool was rehearsed on staging the same day (5/5).

- 2026-10-30 21:03 UTC: PRs #70 (`stories-live`) and #71 (`stories-media`) merged into `main` by the owner; the
  website redeployed without a change of its own.

- 2026-10-30 20:50 UTC: `SUPABASE_SERVICE_ROLE_KEY` removed from Vercel's **Preview** environment (Production keeps
  it): a preview build of any branch no longer holds the production service key. Previews cannot run the Buzz write
  API or finish Mux uploads; nothing used them for that. The key itself was not rotated.

- 2026-10-30 20:30 UTC: **migration 59 (a story's photo and video) applied to production on its own**, after 58 and
  ahead of the Business v2 release, with the owner's approval: story photos in `uploads/stories/<author>/`, read through
  the API by their owner alone; photos and videos accepted only from the author's own uploads; a story's photo deleted
  with the story; the sweep at expiry, every ten minutes. JSON backup `2026-10-30-before-migration-59` and a read-only
  `verify.mjs --live` first. The two stories shared before it keep their photos in `posts/` until they expire.

- 2026-10-30 19:30 UTC: **migration 58 (Stories) applied to production on its own**, ahead of the Business v2
  release (44, 46 and 49 to 57 stay pending): the file as one query through the Management API, then its
  `_migrations` row, after the JSON backup `2026-10-30-before-migration-58` and a read-only `verify.mjs --live`
  showing production in the rehearsed state. Rehearsed the same day offline (`stories-rollout.test.mjs`: 58 after
  48, then the release after it, then 58's rollback alone) and on staging through the real API
  (`staging/stories.mjs`, 12/12; 58 stays on staging). PR #69 (`stories`) had merged at 17:26 UTC with the app's
  Stories and the migration; the app in Expo Go had shown "Not available yet" until the apply.

- 2026-10-29 07:18 UTC: PR #59 (`business-hours`: the public profile's preview from the sidebar, the Website button,
  opening hours; migration 57, not on production) merged into `main`; Vercel's production deployment finished at
  07:19 UTC.

- 2026-10-25: `4294c2f` gave the app's full-screen viewer the app's tab bar in place of its "Add comment…" bar; the
  merge `8951d46` (main into `business-portal-prelaunch`) the same night kept the older viewer and undid it, without
  anyone noticing until 2026-10-30, when `reel-viewer-actions` restored it (`floating-tab-bar.tsx` had kept its half).

- 2026-10-29 06:14 UTC: PR #58 (`business-inbox-pending`: the Inbox below Overview for a business awaiting review
  too; no migration) merged into `main`; Vercel's production deployment finished at 06:16 UTC.

- 2026-10-29 04:06 UTC: PR #57 (`business-inbox`: the business Inbox below Overview, with alerts and inquiry context;
  no migration) merged into `main`; Vercel's production deployment finished at 04:08 UTC. As merged, a business
  awaiting review had no Inbox in its sidebar (`business-inbox-pending` changes that).

- 2026-10-29 03:34 UTC: PR #56 (`business-sidebar`: the business portal's left sidebar, Billing and Settings pages;
  no migration) merged into `main` and so deployed.

- 2026-10-28, afternoon: read-only checks of production (owner's approval) found migration 47 applied
  on 2026-10-27 at 04:37 UTC although the docs listed it as pending, and no Supabase-managed backup
  (Free plan). A second independent review of the ad approval and payment rules found eight more
  problems in 55 and 56; fixed on `business-v2` and attacked again through the real API on staging,
  which was then brought to production's state (47 applied) and restored.

- 2026-10-28 07:06 UTC: PR #51 (`business-v2`'s second round: migrations 55 and 56, the video
  routes, the independent review's fixes) merged into `main`; production's website runs it, its
  migrations are not applied.

- 2026-10-28, from 08:20 UTC: staging (`campconnect-staging`) caught up to production's migrations
  (41, 42, 45 and the two admin migrations), then the Business v2 release (44, 46, 47, 49 to 56) was
  rehearsed on it and rolled back again, leaving it in production's state. The rehearsal found and
  fixed an ad trigger problem in 50 and 56 before either reached production (branches/business-v2.md).

- 2026-10-28 06:18 UTC: PR #50 (`ankur/dev`: Buzz threaded replies, top reply, prompt threads,
  categories) merged into `main` with migrations numbered 51 to 54. The two unmerged migrations on
  `business-v2`, 51 and 52 in its commit messages, were renamed to sort after them
  (`20261109000000_media_server_fields.sql`, `20261109000100_business_hardening.sql`): now 55 and
  56.

- 2026-11-03: PR #53 (`auto-hide-reports`: content 10 different people report is hidden, flagged for
  CampConnect Admin's Flagged page, its owner told, the hide audited) merged into `main` with its
  migration renamed from `20261110000000_…` (57, a timestamp `main` had taken for the business hours)
  to `20261116000000_report_auto_hide.sql` (64), after a merge of `main` that kept migration 62's
  story branches in the two Trust & Safety functions it replaces. Applied to production the same day
  (below).
- 2026-11-03 04:14 UTC: migration 64 (`20261116000000_report_auto_hide.sql`) applied to production
  alone, with the owner's approval, after a full backup (`before-migration-64`) and a zero-difference
  schema diff; every object checked after and the schema matching the repo exactly (migrations.md).
  CampConnect Admin's Flagged page works from then on.
- 2026-11-03: PR #95 (`admin-sections`) merged into `main`: CampConnect Admin's sidebar becomes nine
  sections (Dashboard, Users, Moderation, Content, Business & Ads, Analytics, Operations, Support,
  Administration), each section's pages as tabs; new pages Appeals, Events, System health, Email,
  Support requests, Issues and Settings; Alerts and Pending decisions on the dashboard; Verification
  on Users (docs/technical-reference.md, "CampConnect Admin: sections"). Migration 65
  (`20261117000000_console_health.sql`) applied to production at 05:02 UTC the same day, alone, with
  the owner's approval, after a full backup (`before-migration-65`) and a zero-difference schema diff;
  checked after, the schema matching the repo exactly (migrations.md).
- 2026-11-04 08:30–08:31 UTC: staging (`campconnect-staging`) brought to production's schema, with
  the owner's approval, for the `ads-delivery` staging run. Since the release rehearsal's rollback it
  lacked 15 migrations production has: staff invitations by email (applied outside the repo), 44, 46,
  49 to 57, 63, 64 and 65. First one dry run of all 15 in a transaction rolled back, then each in its
  own transaction with its `_migrations` row; no existing table's rows changed. Staging also keeps
  `20261116000000_calls_paused.sql` from `pause-calls`, which production does not have.

## Retired branches

When a branch is merged and deleted, add a line here (name, what it delivered, its PRs) and delete
its file in `branches/`.

- `auto-hide-reports` (Yubraj, 2026-10-28 to 2026-11-03): the report auto-hide backstop, migration 64
  and its PGlite suite, the console's limitation note U1. PR #53. Deleted after the merge.
- `admin-sections` (Yubraj, 2026-11-03): the admin app's nine sections and their pages, migration 65 and its
  suite. PR #95. Deleted after the merge.

# Project status

As of **2026-10-31**. Sources: the code, commit messages, and the owner's deploy notes (read-only
checks of production). Migration-by-migration status is in [migrations.md](migrations.md); branch
details in [branches/](branches/README.md). Refer to an item below by its title.

## Completed (on `main`)

- **Accounts:** university-email-only sign-up (form + trigger), confirmation email, optional
  Google sign-in, profiles (TikTok style), profile privacy controls, verified-student badge.
- **Social:** follows with private follower lists, threaded comments with likes, sharing to friends,
  blocking, notifications with mutes and mark-all-read, activity status, push (migration 36).
- **Home:** Orbit (posts + reels blend), Buzz tab, Reels viewer, floating "+" on Orbit, the menu
  under your photo; Posts kept as a tabless section.
- **Create flow (app):** camera first (BUZZ | POST | REEL | SNAP since 2026-10-30, front lens by default), gallery,
  editor, publish with title, link, audience (campus | global | friends | selected) and comments
  switch; roommate posts and Marketplace items made in the same flow, optionally anonymous.
- **Search** (the former Discover tab, a screen behind the magnifier beside the bell since the
  `events` branch): search plus popular posts, topics and accounts per campus (falls back until 44
  is live).
- **Buzz v2:** anonymous threads, moderation engine, staff console at `/admin` (41 + 42 live since
  2026-10-26). Since PR #41 (2026-10-27) an emoji no longer holds a Buzz for review. In the app,
  replies form a Reddit-style tree, feed cards show a top reply, and each day's prompt has one
  thread per feed; in the app and on the website a buzz may have a category. These need 51 to 54,
  not live as of 2026-11-01; until then both fall back (two levels, no top reply, prompt answers
  as their own buzz, no category kept).
- **Messages:** realtime chats, groups, semester course chats, voice messages, replies,
  attachments, requests, mute; **Snaps** (view-once); **Calls** (built, paused).
- **Explore:** apartments with PostGIS distance and maps, roommates, Marketplace (one video per
  item, no comments), anonymous listings with per-chat reveal (47, live since 2026-10-27).
- **Business portal** (`/business`): live with migration 39. Its left sidebar, Billing and Settings pages (PR #56,
  2026-10-29 03:34 UTC) and the Inbox below Overview with live alerts and inquiry context (PR #57, 04:06 UTC; for
  businesses awaiting review too since PR #58, 06:14 UTC) are on production too; Ads and Analytics still need 49 and 50.
  **Made instant on `business-performance`** (2026-10-30, pushed, PR to open): no Auth round trip per request
  (local token verification in the proxy and the portal), parallel and deduplicated reads, pages prefetched in full on
  intent, skeletons that wait 160 ms, filters that cost no request, one live channel and a self-updating Inbox list;
  `npm run check` and the unit tests pass, the browser timings (`apps/web/e2e/business-performance.mjs`) still need a
  staging run ([branches/business-performance.md](branches/business-performance.md)).
- **Staging** (`campconnect-staging`) has production's migrations since 2026-10-28 (it got 41, 42,
  45 and the two admin migrations then; `verify.mjs --live` against it matches production's model).
- **Video:** Mux uploads and tours. **Mobile:** Expo SDK 58 / RN 0.88; Android release build works
  (R8 rule for LiveKit).
- **AI documentation:** the root `CLAUDE.md` (PR #42), restructured on 2026-10-27 into one shared
  file plus these docs (PR #45).

## Open work, in priority order

- **Events** (PR #74, merged and deployed 2026-10-31 03:43 UTC; [branches/events.md](branches/events.md)): the bar is
  Home, Explore, Messages, Events, Profile; the Events tab (For you | All events, date and category pills, search,
  saved), event pages, organizations that students create and staff verify, the university's ICS and RSS feeds synced by
  the website, the console's Events section; migration 61, rehearsed offline and on staging, **on production since
  2026-11-01 23:31 UTC**, alone, after a full backup ([migrations.md](migrations.md)): the Events tables exist there, so
  saving interests no longer fails with "Could not find the table 'public.event_interests' in the schema cache".
  Checked through the API and, as a student, inside a transaction rolled back afterwards (interests picked, read back,
  replaced; another student reads none); **not yet checked in the app on a real iPhone** (save interests, close the
  app, reopen it). Reviewed on 2026-10-31 through a staging-backed preview with Texas State's real calendar synced.
  Still to do, each with the owner's approval: `CRON_SECRET` in Vercel's Production environment, Texas State's
  calendar feed added in `/admin/events`, an EAS update so testers get the tab (and PR #81's filters and readable
  Events error).
- **Profile navigation** (`profile-navigation`, 2026-11-02, pushed; PR to open): someone's profile opened from a
  post closed only with a swipe from the very screen edge, a few points wide: iOS 26's full-screen back swipe waits for
  any sideways scroll view under it to give up, and the profile's tab pager never does (reproduced on the iOS
  Simulator). Now on the first tab of a pushed profile the pager takes no touches (a scroll view switched off once the
  finger is down is too late, also tried), a swipe right from anywhere is iOS's own back swipe, following the finger
  with Home behind it where it was, and a leftward drag moves the pager to the next tab by the same intent rule. Your own
  photo or name on a post, a reel, a comment or a mention opens the Profile tab instead of a copy of your profile
  (`useOpenProfile`). The Profile tab no longer collapses the bottom bar on a flick; the profile's header, its
  information and its tabs row never changed size (they scroll up as one), so the bar was what shrank (read that way:
  to be confirmed). Checked on the Simulator against staging: the back swipe mid-drag and on release, Home's place kept,
  the leftward tab swipe, a nudge springing back, a rightward swipe on the second tab changing tab, vertical scrolling,
  your own name opening the Profile tab and Home kept. Also on the branch: a square of Profile → Listings shows only
  its kind's small icon over the photo (people for a roommate post, a tag for an item, a house for an apartment), with
  no "For sale", "Roommate post" or title over it; and New Message's search field is the compact one (40 points, 12
  above and below, aligned with the list) with a little more room between the people in its list. Both looked at on the
  Simulator against staging with a throwaway item and roommate post, deleted afterwards. Not checked on an iPhone. App
  only, no migration.
- **Messages' header scrolls with the list** (`profile-navigation`, 2026-11-02, pushed; PR to open): the title,
  Chats | Groups, the search field and the All | Unread | Requests pills stayed fixed over the inbox. Now they scroll
  away with the list on screen, point for point, and come back only as it returns to its top; only the bottom bar stays,
  and on Messages it no longer collapses on a flick (the owner asked for it to stay fixed). Checked on the Simulator
  against staging with twelve throwaway chats (deleted afterwards): a slow drag (the header and the rows move together),
  the header gone and staying gone on a scroll back mid-list, a swipe to Groups and back with no jump, a drag from the
  title, a tap on Messages and pull to refresh (the spinner below the header), a new pill while the header was part
  way up (both back at the top), a flick (the whole bar stays), and a search (the header holds still, results under it).
  A tap on the search field could not be scripted on the Simulator (on Events' either), so the search was opened with
  text typed in by a temporary edit, since removed. Not checked on an iPhone or in light mode. App only, no migration.
- **Password recovery, and sign-in's words** (`password-recovery`, 2026-11-02, pushed; PR to open): "Forgot
  password?" in the app sent a reset email, but nothing anywhere let the person set a new password from its link (the
  website had no page for it and no "Forgot password?" of its own), so a forgotten password could not be recovered.
  Now: `/forgot-password` and `/reset-password` on the website, a Forgot password screen in the app, and a
  `reset-password` screen in the app for a link that opens it and for Settings → Safety & Security → Change password.
  Both apps ask Supabase for the implicit kind of link, so it opens in any browser (decisions.md); the page reads the
  session from the link and enters it; a link lasts an hour and one use, and an expired, used or hand-opened page says
  what to do. Supabase's answers are said in plain words that never reveal whether an account exists; emails are
  trimmed before they are checked (iOS adds a space). No production Supabase setting changes: a redirect to any
  address on the site's own host is allowed. Checked on staging through the API (`staging/auth-recovery.mjs`, 14/14:
  sign-up, confirmation, login, both error paths, the link, the new password, expiry, the allow-list) and the website
  in a browser (`e2e/password-recovery.mjs`, 9/9); in the app on the Simulator by deep link (the Mac's screen was
  locked, so nothing was tapped): Forgot password, the Change password row and form, an expired link, and a recovery
  link's tokens entering the screen's session (as query parameters: Expo Go's `exp://` address drops a `#` part; a
  real `apartmentbook://` link carries them after the `#`, to be checked on a development build). Not yet tried on an
  iPhone: the Forgot screen's send and the reset form's save, in the app (the same code the website and the staging
  probe exercised). **Ankur's "Invalid login
  credentials"** on production was not looked up (that reads a student's account): with Google sign-in off there, it
  is a wrong password or no account for that email; Forgot password now covers the first, Create an account the second.
- **The story viewer, redesigned** (PR #86, merged 2026-11-02 05:28 UTC, the website redeployed without a change of its own): on a tall phone the
  story is a rounded 9:16 card under the status bar and its actions sit on black below it (`storyFrame`), so they are
  always legible and a tap that misses one never moves the story on; on a short screen (iPhone SE) the story fills it
  and the bar floats over a deeper shade. The reply pill says "Reply to Ann…" with a round send arrow inside it once
  there are words; the heart and the paper plane are 46-point targets (SF Symbols), hidden while typing; your own story
  has Activity (views and likes, a tap lists them), Send and Delete with their words under them (Delete moved down from
  the header). The header: thinner bars, the name, "1h · Friends" (who it was shared with unless everyone), More and
  Close without plates. Holding a story fades every control away. Also fixed: a tap on the story now always puts the
  reply away (with a hardware keyboard `Keyboard.dismiss()` alone left the field focused), and the list of views was
  dark text on the dark sheet. Checked on the iOS Simulator (iPhone 17 Pro) against staging: someone else's story, Like
  and Unlike, typing, the hold, your own story, Activity and its list, Send's share sheet. Not checked: the short-screen
  layout (no simulator of that size here) and a real iPhone. App only, no migration; testers get it with an EAS update.
- **Story likes, replies and sharing** (`story-actions-fix`, 2026-11-02): on production a like answered "Could not find
  the table 'public.story_likes' in the schema cache", a reply "violates check constraint messages_shared_post_check",
  and a share "Some people in this chat can't see this story". One root cause, **migration 62 was not on production**
  (no `story_likes`; the card check still refused a story card), and a second for the share's words: the share sheet
  and the website's share dialog guessed that reason for any failed send of a non-Global card, and `sendSharedPost`
  dropped the real one. Reproduced offline on production's state. Fixed on the branch: `sendSharedPost` returns each
  failure's reason (`shareFailureOf`) and both sheets say it, naming the friend or group; the app's share sheet offers
  group chats as well as friends; the heart's requests go one at a time with the last tap winning (`createLikeSync`);
  a like, reply or mute on a database without 62 says so in words (`STORY_ACTIONS_NOT_READY`). 62 itself needed no
  change: its offline suite now covers group chats and every audience (46 checks). On staging, 62 applied and
  `staging/story-actions.mjs` 15/15; the website on staging (a story reply in Ann's inbox and chat, a story shared
  into a group, nothing in the group with someone who may not see it, no request to production). **Migration 62 on
  production since 2026-11-02 04:32 UTC**, alone, after a full backup ([migrations.md](migrations.md)): likes, replies
  and shares work against production from then on (checked as students in a rolled-back transaction). **Not checked
  in the app on an iPhone** (the Mac's iOS Simulator stopped drawing within a minute of each boot). Still to do: the
  pull request; an EAS update for the app's part (share reasons, group chats, the heart), not approved yet.
- **Apply the pending migrations.** One run of `db:setup` from `main` in database-URL mode
  ([supabase/CLAUDE.md](../supabase/CLAUDE.md)), after a backup, applies them in file order: 44 and
  46 together, 49 and 50 (Business v2), 51 to 54 (Buzz), 55 and 56 (Business v2, PR #51), once
  `business-v2`'s ad trigger fix is merged (the order of release below). Confirm with `verify.mjs --live`, then
  publish the app update. Their code is already on `main`, which deploys production, so this is
  overdue. Needs the owner and a credential. Ankur's 44, 46 and 51 to 54 (Discover and Buzz) can go
  ahead of that run on their own, in two transactions, rehearsed offline on 2026-11-01
  ([migrations.md](migrations.md), "44, 46 and 51 to 54 ahead of the release"); they wait on the
  staging rehearsal and Sunil's approval.
- **UniBuzz Business v2 is on `main` without its migrations.** PR #49 was merged on 2026-10-28 at
  04:07 UTC (and #51 at 07:06 UTC), so production's website runs Business v2 code while neither
  migration 49 nor 50 is applied (production's `_migrations`, read-only, 2026-10-28). Until they are, the code
  says these are broken on production:
  - creating and editing posts in the portal;
  - team invites;
  - the Ads screens;
  - "Message" on a business profile.

  On staging in production's state, this code shows an error screen on the portal's Ads and
  Analytics pages and the Business admin's Ads, Reports and Audit pages (2026-10-28). Student
  feeds carry on without ads. The owner chooses (both write to production):
  - the order of release below, now;
  - or revert PR #49 on `main` first, until the migrations can be applied.
- **UniBuzz Business v2** (merged in PR #49 on 2026-10-28 at 04:07 UTC). It upgrades the v1 portal to the business spec:
  - team roles;
  - business posts;
  - the Ads Manager with admin review and recorded payment;
  - Sponsored ads in For You, Reels and Housing;
  - public business profiles;
  - analytics from real events;
  - an Apple-style portal with light and dark modes.

  Order of release (the full list, rollbacks included, is "Production deployment checklist" in
  [branches/business-v2.md](branches/business-v2.md); rehearsed on staging on 2026-10-28). PR #51,
  the website part with 55 and 56, is live since 2026-10-28 07:06 UTC.
  1. Gates: `business-v2`'s fixes to 50, 55 and 56 merged (done: PR #52, 2026-10-28 19:03 UTC), and
     a restorable backup possible: production is on the Free plan, with no Supabase-managed backup
     (read-only check, 2026-10-28), so Pro's daily backups or a CLI dump.
  2. Release day: back up (a CLI dump, and `scripts/backup.mjs`), then check production is in the
     rehearsed state (`verify.mjs --live --except …`).
  3. Run `db:setup` once from `main`: 44, 46 and 49 to 57 (57 on `main` since PR #59; 47 and 58 to 60 are applied), and 63 once `admin-analytics-business` merges (61 goes alone first, as 58 to 60 did; `ALLOW_OUT_OF_ORDER=1`, since 44 and 46 are older than rows already applied). Then `verify.mjs --live`
     and the smoke test.
  4. Publish the app update.
  If it must be undone, the release's rollback is 63 (once merged; its functions read 50's tables, so it goes first), 57, 56, 55, 50 and 49 only: Buzz's 51 to 54 stay. Once an ad
  without a listing or deal has a recorded payment, 50's rollback first needs those payments refunded and deleted.
  **Reviewed and rehearsed again on 2026-10-30** (two staging cycles, all green); the Preview gate is closed (the
  service key left Vercel's Preview environment on 2026-10-30) and a restorable backup now exists: this repo's full
  backup and restore (`scripts/backup.mjs --full`, `scripts/restore.mjs`), rehearsed on staging on 2026-10-30; Supabase's
  own daily backups (Pro plan) remain the better path. See "Review of 2026-10-30" in
  [branches/business-v2.md](branches/business-v2.md).

  Follow-up work is listed in [branches/business-v2.md](branches/business-v2.md).
- **Business hours and the profile preview** (PR #59, merged and deployed 2026-10-29 07:19 UTC): the preview and the
  Website button are live on the website; the hours need **migration 57** on production (with the release above) and
  the app's part an EAS update, both the owner's approval. Until 57, the website shows and offers no hours. See
  [branches/business-hours.md](branches/business-hours.md).
- **Explore and Events, simplified** (`discovery-redesign`, PR #81, merged 2026-11-01 23:18 UTC): three levels (the
  section labels; one search field with a filter button counting the filters on; one row of chips: each page's few quick
  filters, a removable chip for every other choice in force, Clear), the rest in the filter sheets (Marketplace
  categories and roommate post types moved there, a dot by each group in force); For you's interests panel is one
  dismissible line, and Your interests is in the Events filter sheet. The quick filters are thin-outlined pills, the one
  in force UniBuzz blue; Housing and Roommate have no video quick filter (it is in the sheet). Profile tabs change only
  on an intended swipe (18% of the page, or a 500 pt/s flick over 24 points) and the bottom bar's collapse starts over
  on each profile tab; the grid's blinking was reproduced on the iOS Simulator by recording the screen and measuring a
  square's brightness frame by frame (a touch dimmed it to 85% until the touch became a scroll or a swipe; a slow
  sideways slide on the first tab opened the post) and is gone there after the fix (no dimming, a 10-point tap
  allowance, pictures kept in memory). Not yet checked on a real iPhone. Shared logic in
  `packages/shared/src/discovery.ts`, offline tests. Seen on the iOS Simulator (iPhone 17 Pro, dark theme): Housing,
  Marketplace and For you laid out; **tapping the chips and the sheets not tried there** (the simulator's display
  stopped updating), nor on a real iPhone. App only; reaches testers with an EAS update (owner's approval).
- **Settings, redesigned** (`settings-redesign`, PR #80, merged 2026-11-01): the long single screen becomes a menu of
  sections, each its own screen (Account & Profile, Privacy, Safety & Security, Notifications, Appearance, About &
  Support) on Apple-style grouped rows; switches and choices save at once, the two forms with Save; each saves only what
  it changed (`updateProfileSettings`); a searchable university picker that allows only the university the sign-in email
  proves; Blocked accounts with Unblock (new); Delete account as quiet text at the bottom of Account → Account
  Management. Seen on the iOS Simulator (iPhone 17 Pro, dark theme): every screen. Nothing was saved there (the
  simulator is signed in to a live account); **saving, the light theme and a real iPhone not tried**. App only; reaches
  testers with an EAS update (owner's approval).
- **Home's feeds reach the top edge** (`home-full-bleed-top`, PR #79, merged 2026-11-01): the opaque strip under the
  status bar is gone; For you and Buzz scroll on to the screen's top edge once the top bar has slid away, clearly
  visible, with only a faint tint behind the clock (20% at the top, none below the status bar) that fades in only then;
  on Buzz the top bar now slides away too, the filter bar with it. Seen on the iOS Simulator (iPhone 17 Pro, dark theme,
  For you): a photo runs behind the clock and the Dynamic Island. **Not tried on a real iPhone**; the light theme and
  Buzz (its first-buzz notice) not seen on screen.
- **The bottom bar collapses by the speed of a scroll** (`nav-velocity-collapse`, PR #78, merged 2026-11-01): reading at
  any pace keeps the whole bar; a flick of 700 points a second or more, over at least 32 points, collapses it to the
  tab's icon at the bottom left with the "+" as its twin; 24 points back, or the top, restores it. On every tab's lists,
  Messages and Profile now included (`packages/shared/src/scroll-collapse.ts`, offline tests). Checked on the iOS
  Simulator (iPhone 17 Pro) with scripted drags on Orbit, Marketplace, Events, Messages and Profile: 278 to 625 points a
  second kept the bar, 1,643 to 1,786 collapsed it, small turns were ignored, one change per gesture, sideways photo
  swipes at over 2,000 never counted, short lists never flicker. **Not tried on a real iPhone**; Buzz (its first-buzz
  notice was up), Reduce Motion and a profile with posts not tried. The values still need tuning on a phone. Reaches
  testers with an EAS update (owner's approval).
- **The full-screen viewer in the app**: no "Add comment…" bar, the tab bar kept in view, the rail nearer the right edge
  (PR #61); closing from a later reel shrinks into the post it was opened from (PR #62); the zoom at Instagram's speed
  and no blur under the words (PR #63); Buzz's photos and video in the same viewer, anonymously (PR #64); swiping up and
  down through the Buzz list's buzzes with media (PR #65); every picture whole from the screen's top edge, a blurred
  copy of it filling the rest, in the post viewer, chat media and Snaps (`viewer-full-bleed`, PR #77, merged 2026-11-01:
  seen on the iOS Simulator (iPhone 17 Pro) for photos; **not yet confirmed on a real iPhone**; videos, chat media and
  Snaps not seen on screen). All reach testers only with an EAS update (owner's approval); none has been timed on a
  device.
- **The Buzz thread, laid out like Reddit's** (PR #66): larger replies with their actions at the right, subtle thread
  lines that fold their branch when tapped, a band between conversations, a button to the next one. App only; reaches
  testers with an EAS update (owner's approval). Not seen on a device.
- **Snap previews in chats** (PR #67): a lighter frost and a slow drift while unopened, in the app and on the website.
  The preview itself is unchanged (32 pixels). Not seen on a device.
- **One camera for POST and REEL** (branch `camera-post-reel`, no PR yet): BUZZ | POST | REEL | SNAP; one TikTok row
  above the shutter for both (3m, 60s, 15s, Photo); on iOS the camera stays in video mode, so switching never reloads it
  (photos then come from the 1080p video session, 16:9 rather than 4:3, their exact size the phone's; the microphone
  indicator stays on while the camera is open). Merged as PR #68. Not tried on a device: photo size and back-camera
  flash in video mode need checking there.
- **Stories** (PR #69, merged 2026-10-30 17:26 UTC; **migration 58 live since 2026-10-30 19:30 UTC**, applied on its
  own ahead of the release above, so it leaves that release): a row of story rings under Home's tabs with "Your story",
  a full-screen viewer (tap, hold, swipe, pull down; your own views with who; redesigned in PR #86,
  2026-11-02: a rounded card with the actions on black below it, below), "Your story" beside Post on the publish
  screen with the post's own audience choice; the database keeps the audience, the 24 hours and blocks. Shared from
  the owner's iPhone in Expo Go against production on 2026-10-30: a Texas State story, seen from a second account, and a
  Selected people story, both with exactly 24 hours (a read-only count of production; deleting one on the device and
  the 24-hour expiry not yet watched there). `stories-live` adds: the viewer's
  bar waits for the photo or video and stops while a video buffers, the next photo loads ahead, expired stories leave
  an open tray, and Home's pull to refresh reloads the tray. `stories-media` adds **migration 59** (live since 2026-10-30
  20:30 UTC, applied on its own after 58): a story's photo moves into `uploads/stories/<author>/`, which only its owner reads through the
  API; the database takes a photo from there only and a video only from the author's own uploads, and deletes the
  photo when the story goes (deleted, expired within ten minutes, or its account gone). Stories shared before 59 keep
  their photo where it was. **Migration 60** (branch `post-media-privacy`; live since 2026-10-30 21:46 UTC, applied on its own)
  closes the same gap for every other folder of the uploads bucket: through the API a person's files are listed by that person alone (a Friends-only or Selected
  people post's photos could be found by listing `posts/<their id>/`), a post takes only its author's own uploads, and
  a post's photos are deleted when the post goes. Testers' builds get Stories with an EAS update (owner's approval).
  App only (the website shows no stories yet).
- **Analytics and Business for the UniBuzz team, and CampConnect Admin on `main`** (PR #60, merged 2026-11-02): two
  new sections of **CampConnect Admin** (`apps/admin`) for owners and admins of the staff in a two-factor session.
  Analytics: growth, active and engaged students, engagement, ad delivery, the review queue and revenue, live, with CSV
  exports. Business: advertisers, campaigns (review with the payment, drafting, schedule and budget, pause), payments,
  a rate card, students' reports and the business audit log. The PR also brings the admin app itself to `main` from
  `step-admin`, with its scripts, suites and README section (its migration files stay where they are:
  [branches/step-admin.md](branches/step-admin.md)); on the website only two sign-in and account-deletion messages
  change. **Migration 63** (`20261115000000_console_business.sql`), **not on production**: until it is, both sections say
  they need it. Rehearsed on staging 2026-10-30/31 with the Business v2 release, through the API and in the admin app
  signed in as staff with a second factor. Still to do, each with the owner's approval: the release (63 goes with it),
  `grant_role` for business admins, the `campconnect-admin` Vercel project (reconnected to the repository on 2026-11-02) deployed from `main`, which its first merge touching `apps/admin` does. See
  [branches/admin-analytics-business.md](branches/admin-analytics-business.md).
- **Buzz on the website.** The app has the threaded replies, top replies and prompt threads; the
  website still shows two levels of replies, no top reply, and prompt threads as ordinary buzzes
  (categories it has). See [branches/ankur/dev.md](branches/ankur/dev.md).
- **Security fix pending.** A security fix for a live part of the database is ready on a local,
  unpushed branch (2026-10-27) and is **not applied to production**. Its details stay out of this
  repository until production is patched, because the repository is public.
- **Decide and merge `step-admin`.** `admin-analytics-business` (draft PR #60) brings its app, scripts, suites,
  README section and website hunks to `main`'s tree (as of 2026-10-31); what still waits is its migration files'
  placement, production's `_migrations` rows, migration 18 and the `hidden_at` message types: the owner's questions
  1 to 3 and 5 of its merge plan. The website keeps its `/admin` console (decided). See
  [branches/step-admin.md](branches/step-admin.md).
- **Reconcile the Supabase CLI migration history** on production (applied-outside-repo README
  step 5), only after `step-admin` is merged, never with a real `db push`.
- **Fix the duplicate "migration 44" headers** ([migrations.md](migrations.md)).
- **Housekeeping**, when the owner says so: close PRs #43, #44, #46 and #47 without merging (they
  only carry old per-branch `CLAUDE.md` copies, #47 also the stray `app.json`, and conflict with
  `main`); delete the branches
  [branches/README.md](branches/README.md) lists as safe to delete; revert the stray `app.json` on
  `business-portal-prelaunch`; retire `step-1-brand-shell`; remove the leftover `claude/…`
  worktree branch.
- **Optional: hard-coded project refs.** The live project ref is written into the README,
  `docs/technical-reference.md`, `scripts/e2e-home-feed.mjs` and the scripts in
  `apps/mobile/e2e/`. Reading it from `SUPABASE_PROJECT_REF` instead would let them run against a
  staging project. Not a secret (it is part of the public URL), so not urgent.

## Blockers and known risks

| Item | Where it is written up |
| --- | --- |
| Two migrations not on production (44, 46), while `main`, which deploys production, already uses them (47 was applied on 2026-10-27) | [migrations.md](migrations.md) |
| Business v2's code is on `main` (PRs #49 and #51) while migrations 49 and 50 are not on production (read-only check, 2026-10-28): posts, invites and the Ads screens in the portal fail until they are applied | "UniBuzz Business v2 is on `main` without its migrations" above |
| `db:setup` token mode resets the production auth Site URL to localhost by default | [supabase/CLAUDE.md](../supabase/CLAUDE.md) |
| A security fix for a live part of the database is pending | "Security fix pending" above |
| Supabase CLI history empty on production; `supabase db push` would re-run everything | `supabase/applied-outside-repo/README.md` |
| Calls need an Apple Developer Program membership (USD 99/yr); native ring (CallKit/PushKit, Android full-screen intent) not built | README §"Calls" |
| `is_suspended(uuid)` callable while signed out (low severity) | applied-outside-repo README §"Security review" |
| Buzz's `admin.spam` rule pack flags ordinary phrases (staff can turn it off under Rules) | README §"Buzz (anonymous)" |
| A Buzz photo can be dated by Storage's `Last-Modified` despite the publication delay | same |
| Supabase CDN may serve a just-deleted Snap to the same viewer for ~1 minute | README §"Snaps" |
| Supabase free projects pause after a week idle (Pro, USD 25/mo, before real users); built-in auth email is rate-limited (custom SMTP needed) | README §"Production checklist" |
| Vercel Hobby optimizes 5,000 source images a month | README §"Photos" |
| The README still says the Vercel project is not connected to Git, and that 41 and 42 are not live; both are out of date | this file, [migrations.md](migrations.md) |

## Future plans

- **Core, next up:** clubs and organizations (pages to follow and join), campus events, campus
  news (none started); calls switched on (blocked, above); more campuses (a `universities` row
  with its `email_domain` and campus coordinates).
- **Buzz category sections:** buzzes can carry a category (54); how sections show them is not
  decided yet (filter chips on the feed, a page per category, following or muting categories).
- **Explore tools, later:** saved searches with alerts; seller ratings.
- **Long term:** the main digital community for university students worldwide (README
  §"Long-term vision").

# `mobile-ui-beauty-filters`

Sunil's mobile line since 2026-11-16, branched from `main` after PR #112 (`chat-redesign`). **Merged** in PRs #113
(`84b8c4a`), #114 (`147e27d`, `828e0a4`), #115 (`72b6745`, `7e75ea9`), #116 (`c9a1f4f`, `8eea329`: the work of
2026-11-22 and 11-23) and #117 (`75b1f33`, `46959ab`: the card feed's return and the viewer losing its top shade), the
last on 2026-11-24 22:13 UTC; the branch stays in use for the next PRs. The website is untouched; the one database
change is migration 68, on `main` since PR #116 but applied nowhere yet (below).

## What is on it

- **The bottom bar and the camera** (`84b8c4a`): the frosted-glass pill with icons only and Create in its middle;
  the camera lands on SNAP, in the order BUZZ | SNAP | POST | REEL.
- **Beauty filters for photos** (`84b8c4a`): Natural Glow, Warm Beauty, Bright Radiance, as an OpenGL shader over the
  camera's frames on iOS and over the photo as it is taken on both platforms. Video is not filtered: the camera writes
  that file itself (see apps/mobile/CLAUDE.md). The looks are numbers in `packages/shared/src/beauty.ts`; expo-gl is
  optional, so `BEAUTY_AVAILABLE` is checked before anything imports it.
- **The profile's information section** (`84b8c4a`): university, major, class year and bio, in the app's own colours.
- **Pure black full-screen viewers** (`84b8c4a`, `147e27d`, `7e75ea9`): every photo and video drawn whole, in its own
  shape, centred, with black wherever it does not reach; the pagination dots at the bottom, TikTok's way; no Back
  button (a swipe from the left edge, or on the first photo, leaves); no sound button, every video with its sound on.
- **The Home redesign** (2026-11-21, `72b6745`): Orbit | Buzz (Stories had a tab of its own until 2026-11-22), Orbit a full-screen
  TikTok-style feed, the bottom bar Home, Events, Create, Messages, Profile, Explore moved to the compass in Home's top
  bar. See docs/decisions.md for the choices and apps/mobile/README.md for how it works.
- **Stories** (2026-11-21, `72b6745` and after): a post's page with story timing on top — edge to edge on
  black, the name at the bottom left and Orbit's own rail down the right (its geometry imported from `reel-item.tsx`),
  with the progress bars across the top and a cube turn between people. One `StoryPlayer`
  (`src/components/stories/story-player.tsx`) draws the full-screen viewer.
- **Stories back to a row of rings** (2026-11-22): the Stories tab is gone; the rings
  sit across Orbit's top on the first post (`src/components/home/stories-row.tsx`), and a "N new stories" label stands
  in for them once the feed moves on, a tap bringing them back over the post on screen. The viewer has Instagram's top
  again (bars, then who and when, pause, "⋯", Close), the reply field, heart and paper plane along the bottom of every
  story (your own: "Send to friends…" and the views just above), and Instagram's navigation: taps crossing into the next
  and previous person, a sideways swipe between people with the cube turn, hold or the pause button to pause, the
  clock moving on to the next person, a pull down to close. **Fixed a skipping bug**: a story whose picture had to
  load first could be counted as already over (its played time was read back from the bar's animated value, which on
  the JS side could still say "full"), so a person's remaining stories flashed past; the time is kept from timestamps
  now. Checked on sample data with a stand-in signed-in viewer (a temporary export of `SessionContext`, reverted) and a
  temporary dev route (deleted): taps across people both ways, the previous person's last story, pause, hold, your own
  story's layout, and a full five seconds for every story after a pause and a hold. Seen on sample data:
  taps staying on one person, a swipe left to the next person through the cube and right back again, the pull down
  closing, and the viewer closing by itself after the last person. Seen on sample data through a temporary dev route (deleted): the row on
  the first post, the label on the next, the tap revealing the row, the label coming back on the next move and the row
  on returning to the first post, and the viewer opened from a ring. The Simulator was still signed out. On
  the tab the picture is full-bleed behind the tabs (drawn to the frame, not fitted whole like a post), the bars are
  pinned above them, and the creator's photo with a "+" sits over the heart until they are followed. The axes are
  TikTok's: up and down between people, sideways left to Home's sections.
- **The bell's badge** (2026-11-23; the owner's Instagram reference): the red count
  overlaps the bell's top-right shoulder with no ring round it (it had a ring in the bar's colour, black over the
  feed). `HeaderActions`, so every header with the bell. Seen in the Simulator with a stand-in count (removed).
- **Full-width share sheet and story views list** (2026-11-23; the owner's brief): both
  use the full-width `Sheet` (`edge="full"`), the share sheet's list also pulling it down from its top
  (`SheetScrollView`) and its message field riding the keyboard as the comments' does. Seen in the Simulator: the share
  sheet, opened on a sample story (temporary screen, removed); the views list uses the same sheet setting.
- **The story bar is Instagram's** (2026-11-23; the owner's reference image): the field
  reads "Send message…" on someone else's story (still "Send to friends…" on your own), with no fill and a soft grey
  one-point edge; the heart and the paper plane are regular-weight outlines; Instagram's spacing. Seen in the Simulator
  on a sample story (temporary screen and stand-in viewer, removed).
- **Home's top bar retouched** (2026-11-22; the owner's brief): the row 1.2% of the
  screen's height higher (about 10 points), Orbit and Buzz at medium weight (not bold), the underline 60% of the label,
  the compass, bell and magnifier bold. `SlidingTabs` gained `weights` and `underlineShare` and `HeaderActions` a
  `weight`, all optional, so the other tab rows (Explore, Events, Messages) and the tabs' header keep their look. Seen
  in the Simulator, before and after.
- **No dark shade at the top of Orbit** (2026-11-22; the owner's brief): the feeds'
  pages draw no top shade (MediaFrame skips it where a photo's double tap likes), so a picture's top shows clear under
  Home's labels and icons, which keep their own soft shadow; the viewer kept its shade until 2026-11-24 (below). Seen in the Simulator on a 9:16
  photo (temporary screen, removed).
- **TikTok's display for photos and videos** (2026-11-22; the owner's table): in the
  area above the bottom bar, vertical content (9:16, up to 3:5) fills it, a sliver of its sides cropped on a taller
  phone; 4:5, square and 16:9 show whole and centred (exactly, no longer raised toward the top row). `fitWhole`. Seen in
  the Simulator on Orbit's real page at half size, four shapes side by side (temporary screen, removed). Sponsored
  pages unchanged (their shape is not known).
- **A faster settle for the stories row** (2026-11-22; the owner still found it slow):
  the open/fold settle at the top is the row's own, an eased-out value on the UI thread the feed follows frame by frame
  (`settleY`, 150–260 ms by distance), replacing the scroll view's ~0.3 s eased-in animation; a finger on the feed stops
  it. Same mechanism as the per-frame drive checked in the Simulator earlier; this one not felt (no synthetic touches).
- **The story fills down to the reply row** (2026-11-22; the owner's brief): the
  picture runs from the screen's top to the top of the bottom row ("Send to friends…" / "Reply to…"), cropped to fill,
  its bottom corners rounded, the row on black below; the field takes its on-black style; the heart and the plane are
  matched semibold/bold outlines in equal 44-point squares. Seen in the Simulator on a sample story of your own
  (temporary screen and stand-in viewer, removed).
- **A snappier pull for the stories row** (2026-11-22; the owner found it slow): the
  pull down from the folded first post opens the row past 48 points or on a flick (not half its 232-point room), and
  the settle starts on the UI thread as the finger lifts (`scrollTo` from the scroll handler's `onEndDrag`, the list's
  ref now an animated one), so it never glides slowly on the scroll view's own snap; a swipe up from the open row folds
  the same way. The row eases into view ahead of the pull, the pill fades sooner. Not felt in the Simulator (it takes
  no synthetic touches now).
- **A bolder rail** (2026-11-22; the owner's brief): like, comments, save, share and
  "•••" are solid white glyphs (red when liked, gold when saved, TikTok's), each centred in the same 42-point square with
  a soft shadow, the counts bold with even digits, the column 6 points further right on the feeds (`railRight` 2, as the
  viewer's). `RailButton`. Seen in the Simulator.
- **The stories pill steps away as the feed scrolls down** (2026-11-22; the owner's
  brief, narrowed the same day from the whole top bar to the pill alone): the pill fades away while the feed is dragged
  down to later posts and comes back on any drag up, or at the top of the feed (`scrolledAway`); Home's top bar stays,
  stepping away only for a clear post (`onTopHidden`, `HomeTopTabs` `hidden`). Not seen working in the
  Simulator (it stopped taking synthetic touches); the fade itself is the one checked for clear mode.
- **Pinch and clear mode on Orbit** (2026-11-22; the owner's Instagram screenshot):
  a pinch on a post (photo or video) follows the fingers and springs back; one that went in leaves the page clear
  (everything over the picture fades away, Home's top bar and the stories pill included: `FeedClearContext`) with a small button in the corner to bring it back, as do a pinch out and
  the next post. `ReelItem` (`feedZoom`, `clear`), Orbit's `ViewerPagerLockContext` holds the feed still meanwhile;
  Orbit's photos no longer use the Photos-style `Zoomable`. Seen in the Simulator: only the clear page's look (started
  clear, temporary, removed), top bar gone too; the pinch itself was not tried there (the Simulator stopped taking synthetic touches).
- **The pill is always there** (2026-11-22; the owner's report from their phone): with
  only their own story the pill was missing (it counted only other people's). It now counts every story once the unseen
  ones are watched, yours included ("1 Story"), and reads "Stories" with none, so it is always there signed in.
  `storiesPillText`. Seen in the Simulator with one story of your own only (temporary sample, removed).
- **A smaller pill with no edge, whose taps always land** (2026-11-22; the owner first
  had an earlier attempt with a fainter edge undone): 23 points tall, 13-point words, no border. The first tap after a
  swipe used to be lost (the press began, then was taken away while the feed settled: seen in the Simulator); the
  pill's tap is now a native tap gesture (`StoriesPill`), and `openRow` reads where the feed really is rather than the
  post last reported on screen, finishing the scroll onto the post it is arriving at while the row opens over it.
  Checked in the Simulator with stories forced on (temporary, removed): the same tap code, before the undo, opened the
  row on taps 0.15 s after a swipe over posts 2 and 3 and scrolled to the open row over the first post; after it, only
  the pill's look could be seen (the Simulator stopped taking synthetic touches).
- **The row stays folded until a further pull** (2026-11-22; the owner's brief): the
  row's room is now a header inside Orbit's feed (refresh room, then the row's room, then the posts), with snap points
  instead of paging, and the row follows the scroll (`scrollOpen`, a Reanimated scroll handler); the pill over later
  posts keeps the card (`pillOpen`). Several gesture-based attempts first (a row gesture over the first post, with the
  list's scrolling on and off, earlier and later starts, blocking and simultaneous relations): all failed or were
  cancelled by the post's or the list's gestures, details in docs/decisions.md. Checked in the Simulator with stories
  forced on and sample rings (temporary, removed): a swipe up from the open row folds onto the first post; on to post 2;
  back up to the first post, still folded, pill showing; a held 200-point pull opens it; a pull on into the refresh room
  shows the spinner in the gap and refreshes. The Simulator's synthetic quick flicks proved unreliable (released
  without speed), so the checks used held drags; flick speed on a real phone is the scroll view's own and was not seen.
- **Double tap to like, TikTok's hearts, full-width comments** (2026-11-22):
  `HeartBursts` (`src/components/heart-burst.tsx`); a double tap on any of a post's media on Orbit likes (photos too,
  `photoDoubleTap="like"`, pinch still zooming), on a buzz it upvotes (`upvoteBuzz`), on Buzz cards and in the viewer.
  Comments: `Sheet` `edge="full"` with `SheetScrollView` (a pull on the list's top drags it) and `KeyboardRoom` (the
  composer above the keyboard, the sheet's top still). Orbit's rail, story rings and pill sink on press
  (`usePressScale`). Checked in the Simulator: hearts on an Orbit photo from a quick run of taps (signed-out likes let
  through for the look, temporary, nothing sent); the sheet full width, pulled by its list short (springs back) and far
  (closes); a full-width sheet with a text field and the on-screen keyboard (temporary screen, deleted); the rail's
  press. Not seen: Buzz cards (signed out, Buzz is gated), the real composer with the keyboard, VoiceOver.
- **Quieter pill; Search in Messages and Profile** (2026-11-22; the owner's TikTok
  screenshots): the pill is TikTok's subtle one (see-through dark fill, hairline edge, soft words, small dim arrow).
  Messages: Home's magnifier (the search screen) where the new-message pencil was; the pencil moved beside the inbox's
  search box (`NewChatButton`), so starting a chat is still one tap. Profile tab: the menu's gear at the top left, the
  magnifier at the top right; Find friends, whose corner that was, is now the first item of the gear's menu. Checked
  in the Simulator: the pill over a video (stories forced on, temporary); Messages' header signed out, and signed in on
  a temporary sample screen with the real header components (deleted); the Profile bar's two buttons there too. Not
  seen on a real signed-in Profile tab.
- **Stories row that folds into a pill, TikTok's Following page** (2026-11-22; the
  owner's screen recording; replaces the same day's strip on the first page and floating row): `StoriesHeader` over
  Orbit's pager, one UI-thread value (`rowOpen`) moving the row, the pill, the post as a card under the row
  (`FeedCardContext`: chrome put away, picture raised into the card) and the pager itself. Checked on the real Orbit in
  the Simulator, with stories forced on and sample rings for the look (both temporary, removed; the feed itself the live
  campus feed, read only): open at the top; a drag up folding it with the same post rising to the whole screen; the
  pill on the next post opening the row over it; a tap on the card and a drag up folding it; swiping back to the first
  post opening it; a pull down with it open refreshing, spinner and all. **Not working, by design now**: a pull past
  the top with the row folded; the list nested in Home's sideways pager is never pulled past its top (neither a bounce
  nor a refresh control nor a gesture of the row's own got that pull in the Simulator), so the pill is the way back.
  Not checked: VoiceOver, an ad page as the card, a real signed-in account with real stories.
- **Media stops at the bottom bar** (2026-11-22): on Orbit, its sponsored pages and the
  viewer over the tabs, every photo and video is whole in the area above the bar (`mediaBox`, `mediaBottom`), never
  cropped. Checked on Orbit's real page with 9:16, 4:5, square and 16:9 photos over a stand-in bar: all whole, and a
  pixel scan at the bar's top edge found the 9:16 photo's last row at 760pt and pure black from 762pt down. Videos and
  ads go through the same area but were not looked at on screen (no sample of either).
- **Orbit is the card feed again** (2026-11-24; the owner's request, from a screenshot of the card feed on their
  phone, which still runs the update of 2026-11-21): Home mounts `ForYouSection` for Orbit (posts and reels as
  Instagram-style cards under the story tray, words-only posts included), and a tap on a post's photo or video opens it
  full screen in the viewer, which goes on down the feed with a swipe up, as before 2026-11-21. Home's top bar is solid
  over Orbit and slides away as it scrolls, and the bottom bar collapses on it, as on Buzz (`REELS` in
  `app/(tabs)/index.tsx` and `SOLID` in `home-top-tabs.tsx` name the one page that would be full-screen video, none in the
  app today). The full-screen Orbit (`orbit-section.tsx`) and its folding stories row (`stories-row.tsx`) are kept,
  mounted nowhere. The top bar (Orbit | Buzz at its left, compass, bell and magnifier at its right) and the bottom bar
  (Home, Events, Create, Messages, Profile) are unchanged, though the screenshot showed the older ones (your photo, the
  UniBuzz wordmark, Orbit | Buzz | Reels centred; Explore in the bottom bar). `npm run check` 9/9. Seen in the Simulator
  (Expo Go, signed out, so no story tray and only reads): Orbit's cards under a solid top bar, and a tap on the first
  post's photo opening the full-screen viewer with the rail and the name. Not seen signed in (the tray, likes), on a
  phone or on Android.
- **No dark shade at the top of the full-screen viewer either** (2026-11-24; the owner's report from Expo Go on their
  phone: "some shadowy transparent layer on top" of the full-screen pages): `MediaFrame` draws no top shade on any page
  now (it had kept one in the viewer, and over videos on the feeds), only the bottom one under the name and the rail.
  The viewer's top row holds nothing but the hidden Campus | Global toggle, so nothing there needed it; the white status
  bar is drawn straight over the picture, as on TikTok. `npm run check` 9/9. Seen in the Simulator (signed out, Expo Go):
  a tall video opened from Orbit's cards fills the screen with its top clear.
- **Orbit's cards laid out as Instagram's Home feed** (2026-11-24, after PR #117; the owner's brief with Instagram's
  sizes, not on `main` yet): `InstaPost` draws the photo or video edge to edge with no corners (it was in a rounded frame
  inset 16 points), keeping its shape between 3:4 and 1.91:1 (it was 4:5) and cropped to that when taller or wider; a
  reel shows at 3:4 in the feed (it was 9:16) and whole in the viewer; a carousel's slides all fill the first one's frame,
  its dots now in the middle of the row of buttons (`PostActions`' new `center`) and its "1/3" at the top right; the
  title and caption moved under the picture, after "Liked by …", the author's name in bold before the words and two
  lines before "more…". Words-only posts keep their words under the header. The post's own page (`posts/[id]`) shares
  `InstaPost`, so it changed too; roommate posts, apartments (`post-card.tsx`) and Sponsored cards did not. `npm run
  check` 9/9. Seen in the Simulator (Expo Go, live data read-only): photos edge to edge, a tall screenshot cropped to
  3:4, the caption after the bold name; on a temporary dev route with sample data (deleted): a three-photo carousel
  (3:4, a square second slide filling it, the dots in the row of buttons) and a 2.67:1 photo cropped to 1.91:1. No post
  on production has more than one photo. Orbit's "Could not load more. Tap to try again." showed at the end of each page
  in the same session (a retry loaded the next page): a paging problem, not this change; not looked into yet.
- **The caption back under the name** (2026-11-25; the owner's brief: "caption or bio to top below username in orbit,
  above content"): the title, the caption and the link sit under the header again, above the picture, two lines before
  "more…" over a picture and three on a post of words alone; the bold name before the words is gone with the move.
  `npm run check` 9/9. Seen in the Simulator (Expo Go, live data read-only): "Note" under Sunil Sherpa's name, above
  the photo.
- **Migration 68** (`20261120000000_story_self_like.sql`, `c9a1f4f`): drops the one condition
  of migration 62 that kept a heart off your own story. **Not applied anywhere** — not production, not staging. Until
  it is, the heart on your own story is drawn but the database refuses the like and it goes back with the reason.
  Its rollback and `supabase/tests/story-self-like.test.mjs` (11 checks) ship with it, and it is in the `AHEAD` skip
  of every rollout suite (production, stories, events, story actions, discover/Buzz), like 67: those rehearse
  production's state, where 62 may not be applied, and 68 needs 62's `story_likes`. Its row in docs/migrations.md goes
  in with the PR (root CLAUDE.md, documentation rule 2); `release-rehearsal.mjs` on staging will see it pending until
  it is applied there, as it does 67.

## State

- `npm run check` 9/9 and `npm run test:shared` 316/316 green on 2026-11-21; `npm run check` 9/9 again on 2026-11-24,
  before the 2026-11-22/23 work was committed (nothing in `packages/shared` changed in it).
- Seen on the live account's own Home → Stories (2026-11-21): the owner's own story with the heart / Share / eye / "⋯"
  rail, someone else's with the follow "+" over the heart, the reply pill just above the floating bottom bar, the bars
  pinned above the tabs and the picture running behind them. On sample data: a swipe up and down between people, a
  sideways swipe passing through to the page beside, and the follow button.
- **Expo Go in the Simulator signed itself out part-way through the 2026-11-21 session**, so the last checks were on
  sample data through a temporary dev route. Nothing in the app signs anyone out; it looked like Expo Go losing its
  stored session across reloads. Worth one look on a phone.
- Looked at on the iPhone 16e Simulator (iOS 26.3, Expo Go over a tunnel) on 2026-11-21: all three Home tabs, the pager
  both ways, Orbit's vertical paging, Events as a tab, Explore from the compass, and the stories viewer on a temporary
  dev route with sample groups (deleted again). Not checked on a real phone or on Android.
- **The iPhone build for this branch is `d30b8306-3fdc-4967-91f1-35ec2fa86dd1`** (EAS preview, internal distribution,
  2026-11-21, from `828e0a4`; its install link lapses on 2026-12-05). It carries expo-gl for the beauty filters, so its
  fingerprint (`a98395a2…`) differs from the four-iPhone build of 2026-11-11 (`8f77d85f`): an update from this branch
  reaches `d30b8306` only, and an iPhone still on `8f77d85f` has to install `d30b8306` first. `fingerprint:compare`
  against `d30b8306` still matched at `75b1f33` (2026-11-24).
- An EAS preview update (`da62c538-1b0c-4127-8773-c35f94fb7a17`) was published to the preview channel on 2026-11-21
  from `7e75ea9`, with the owner's approval. The next, **group `7da591cf-31e1-468d-a8d6-869f1da00a8d`** (iOS, runtime
  `a98395a2…`), on 2026-11-24 at the owner's request, carries `main` at `28f2b10`: everything above, the card feed's
  return and the viewer without its top shade included. The Mac's disk was full, so it was exported by hand without
  source maps (`npx expo export --platform ios --dump-assetmap`, the `.env` values matching EAS's `preview` ones by hash)
  and published with `--skip-bundler`; crash reports from it are not symbolicated. Not yet seen on a phone.

## Pending

- The Maestro flow `01-signed-in.yaml` drives the card feed, Orbit again since 2026-11-24, but was written for the
  three-tab Home and has not been run since; and `04-posts-look.yaml` needs a
  Posts tab the app has not had since `HIDDEN_HOME_SECTIONS`. Both say so at the top of the file. Maestro is not
  installed on the owner's Mac, so neither has been run.
- The shared files (docs/status.md, docs/testing.md, docs/branches/README.md) are left for the PR, after `main` is
  merged in (root CLAUDE.md, "Documentation: keep it current", rule 2).

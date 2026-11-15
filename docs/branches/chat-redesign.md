# chat-redesign

- **Owner:** Sunil. **As of 2026-11-15:** branched from `main` at PR #107 (`3a5c613`), `main` merged in at PR #111;
  committed and pushed on the owner's word, a pull request open for his review. **Not merged and not on production**
  (merging deploys the website and CampConnect Admin, unchanged here; the app reaches testers only by an EAS update, a
  production write that waits for the owner). Written by AI sessions (2026-11-06, 2026-11-15).
- **Purpose:** the owner's brief, from a screenshot of a group chat in the app: redesign the app's chat screen into a
  minimal, Apple-style one (aligned top bar, refined bubbles and type, a floating message bar, subtle glass, smooth
  motion), and bring the labels of every tab row closer together (Home's Orbit | Buzz | Reels, Explore's Housing |
  Roommate | Marketplace, Messages' Chats | Groups, Events' For you | All events) without changing what they do. App only,
  no migration; the website is unchanged (its tab rows already sat together, 28px apart).
- **Second brief (2026-11-15):** better photo and video viewing across posts, Reels and messages (full-screen photos with
  pinch, double tap and pan; video play or pause and a timeline to scrub; 1× always, 2× only while a finger is held on the
  video, Instagram's way); the message bar kept right above the keyboard without covering messages, with smooth keyboard
  motion; and no thin lines between Home's Orbit | Buzz | Reels row, the story tray and the feed. Also app only, no
  migration, no new native module (so it can reach installed builds with an EAS update).

## What the screenshot showed

- The top bar's controls were different sizes (a 44pt Back, 40pt Info) and the name sat beside the photo, left of
  centre; the first day stamp showed through the bar's subtitle, because the blur behind the bar was only about a third
  strong at that height and its wash had all but faded.
- The photo at the bottom showed through around the message bar, with nothing dimming it.

## What changed

- **Top bar** (`components/messages/chat-header.tsx`): one row of three glass pieces, each 44pt on one centre line:
  Back; a capsule centred on the screen with the name and, under it, "Active now" (with a green dot), when they were
  last active, or "N members"; the chat's photo on the right (a group's two members overlapping, as in the inbox's
  `InboxAvatar`). The capsule and the photo open the chat's details; the separate Info button is gone. Audio and Video
  call still join the right side when calls are on (`CALLS_PAUSED` unchanged). The capsule's words follow the text size
  up to 1.2×, so they always fit.
- **Scroll edges, top and bottom:** what scrolls under the bar or the message bar is dimmed into the screen's colour
  (`scrollEdge()` in `lib/theme.ts`: 94% at the screen's edge, 82% at the bar's inner edge, nothing 20pt (top) or 16pt
  (bottom) further in) over a blur held at full strength behind the bar (`ProgressiveBlur`'s new `solid`).
- **One side margin:** the bar, the bubbles and the message bar all keep 16pt from the screen's edges (`CHAT_EDGE`).
- **Bubbles** (`message-bubble.tsx`): 16pt words (was 17), 36pt tall for one line, 20pt corners; a run from one person
  is one stack, its corners on the sender's side tightened to 6pt where two bubbles meet (voice messages and call rows
  too); my bubbles a brand-blue gradient that deepens towards the bottom (`bubbleMine`; white words at 4.3:1 or better
  in dark, 4.7:1 in light, as before), the other side's a neutral grey (`bubble`) instead of the bluish input fill. The
  day stamps carry the day in semibold ("**Today** 14:05"). A message that arrives or is sent rises a little and grows
  from its own bottom corner on a spring (a custom Reanimated entering animation with `transformOrigin`). The quote
  above a reply is smaller and quieter (13pt).
- **Message bar** (`composer.tsx`): 16pt field, 32pt microphone or Send; Send (aurora) springs in as the microphone
  fades out once something is typed, and back; the voice recorder keeps the same sizes and 8pt gaps.
- **Tab rows** (`components/sliding-tabs.tsx`): the labels sit side by side in the middle of the row, `TAB_GAP` (24pt)
  apart in every row, instead of spreading to the row's edges (Home, Explore, Events) or sitting 110pt apart (Messages).
  Each label's touch area takes half the gap on either side, so the targets still meet. A row too narrow for the gap
  (a small phone, a large text size) closes it up evenly. Unread badges take their own room after the label (before,
  they hung into the gap and a "99+" on Chats would have run into Groups). Buzz's lime mask is now hung on the Buzz
  label itself (`leading`, `BuzzTabMask`) instead of a copy of the old spread layout drawn over the row.

## What changed on 2026-11-15

- **Photo zoom** (`components/zoomable.tsx`, new; used by the full-screen viewer's photo slides in `reel-item.tsx`): pinch
  around the fingers, double tap to zoom in on the tapped point (until the photo fills the screen, 2× to 3×) or back out,
  one finger pans a zoomed photo with momentum and rubber-banded edges, a pinch past 4× or below 1× gives and springs back;
  all Gesture Handler and Reanimated, on the UI thread. While zoomed the words, rail and shades fade, the page's sideways
  swipe stands down (`usePageSwipe` takes a `locked` value and fails on a second finger) and the viewer's vertical pager
  stops (`ViewerPagerLockContext` in `lib/viewer-chrome.ts`, read by `app/reels/[id].tsx`); a photo turned away or a viewer
  closing over it springs back to rest. **A double tap on a photo in the viewer now zooms instead of liking** (the feed's
  double-tap like, a video's double-tap like and the rail's heart are unchanged). The chat's viewer keeps its own zoom (the
  system's zooming scroll view on iOS), which already did pinch, double tap and pan.
- **Video controls** (`components/video-controls.tsx`, new): `VideoTimeline`, a thin line under the words of every video in
  the Reels tab and the viewer, gliding between the player's reports; dragged sideways it swells, pauses the video on the
  frame under the finger (expo-video scrubbing mode and loose seek tolerance while moving, an exact seek on release) and
  shows "0:08 / 0:13"; a tap jumps. `SpeedBadge`, the glass "2×" pill. Press and hold a playing video: 2× until the finger
  lifts (`BOOST_RATE`, `HOLD_MS` 220ms), the words and rail fading meanwhile; a borrowed feed player goes back at 1×. The
  chat's viewer (`media-viewer.tsx`) drops the system controls for the same pieces: tap to show or hide, a glass play or
  pause button in the middle, the timeline with time gone and time left, a sound switch, the hold for 2×; it now wraps its
  modal in a `GestureHandlerRootView`. `lib/video-ticks.ts` (new) shares a player's `timeUpdateEventInterval` between the
  timeline and the viewer's jump to the feed's time (`goOnFrom`), so neither switches off the other's reports and a feed
  player is handed back reporting as it did.
- **Keyboard** (`app/messages/[id].tsx`, `components/messages/composer.tsx`): the KeyboardAvoidingView and the window
  measuring are gone. Reanimated's `useAnimatedKeyboard` lifts the bar and the message list together by `keyboardLift`
  (the keyboard's height less the bar's resting bottom room, plus `KEYBOARD_GAP` 8pt), as a transform on the UI thread, so
  nothing is laid out while the keyboard moves; the bar's own padding no longer changes with the keyboard; the list's far
  end gets the same extra room while the keyboard is up (so the oldest message clears the header), and its scroll bar is
  inset by the header and the bar (`automaticallyAdjustsScrollIndicatorInsets` off: it is flipped, inverted). Stories
  already used the same hook on both platforms.
- **Home's dividers**: no hairline under the bar (`home-top-tabs.tsx`'s `solid`), none under the story tray
  (`stories-tray.tsx`), and Buzz's bar layer is Buzz's canvas with no line (`buzz-top-bar.tsx`; it was `surface1` over a
  `line` hairline), so the tabs run into each feed seamlessly. Explore's, Messages' and Events' bars are unchanged.

## Checked

- `npm run check` at the root passes (2026-11-06: typecheck, lint and build, 9 of 9 tasks). No unit or database suite
  covers these screens.
- On the iOS Simulator (iPhone 16e, Expo Go, dark and light), through a temporary development screen with sample
  messages and no database (deleted again): the group and the direct chat's bar, runs of bubbles and their corners, the
  stamps, a reply's quote, "Seen" and "Delivered" clear of the bottom fade, Send in place of the microphone, and a new
  message's arrival frame by frame (no errors in Metro's log). The tab rows on Explore and Events as they are, Home's
  row on Orbit and resting on Buzz (the mask clear of "Orbit"), and Messages' row with unread counts through the same
  development screen (the Simulator was signed out, so nothing was read from or written to the live project beyond
  what a signed-out app reads).
- **Not checked:** a real chat with real data (the chat screen itself only changed its margins and paddings, the
  components it draws are the ones checked), the keyboard up, a real iPhone, Android, Reduce Transparency, and a
  large text size.
- **2026-11-15:** `npm run check` passes (9 of 9, before and after removing the development screen). On the iOS Simulator
  (iPhone 16e, iOS 26.3, Expo Go, signed out), driven with mouse events (see the memory note on Simulator checks): the
  Reels tab (live public reels, read only) paused on a tap, played at 2× with the pill while held and back on release,
  scrubbed from the timeline with the time showing and played on from there, without moving Home's pager; the real
  full-screen viewer, opened from a temporary development screen with sample pages (deleted again) and from a public post
  on Home, zoomed a photo by double tap and by pinch (Option-drag), panned it without leaving the post, zoomed out and moved
  on, closed cleanly from a zoomed photo, and showed the timeline on a reel and on a carousel's video slide; the chat's
  viewer showed and hid its controls, paused, held at 2× and scrubbed. The chat's keyboard was checked on a sample chat
  with the screen's own layout and lift code: the bar rides 8-10pt above the keyboard through its animation with the
  newest message just above it, and nothing overlaps. Home without lines on Orbit and on Buzz (signed out, so no story
  tray). Nothing was written to the live project.
- **Signed in, on staging (2026-11-15, the owner's second request):** `apps/mobile/e2e/sim-seed.mjs` with
  `STAGING_SUPABASE_REF` (now seeding a direct chat with a reply, a group chat and Leo's story), Metro started with the
  staging project's URL and anon key in the environment, signed in through `dev-login`. In a real chat: it loads, a
  message typed and sent arrives with "Sent", a swipe to reply puts the quote over the field and the reply goes out with
  it, a photo and a video picked from the library go out as a grid and open in the chat's viewer (the video's controls,
  pause, its end, the photo's zoom), a long press opens the message's actions, and the group chat shows its members'
  names and "Seen". The keyboard: the bar rides 8 to 10pt above it, the newest message just above the bar, nothing
  covered; the bar grows for two lines, a reply's quote and picked files without covering messages; scrolled to the top
  with the keyboard up, the first message still clears the header; a swipe down dismisses it and the bar settles at
  rest; switching to a hardware keyboard drops the bar back to rest once iOS hides its keyboard (one frame caught it
  still risen). Home signed in, dark and light: the tabs, the story tray and the feed with no lines between; a story
  opens in its card and its reply row rides the keyboard. Light mode in the chat with the keyboard up. At an
  accessibility text size (Accessibility Large): the bubbles, the field and the viewer's times grow and fit; Reduce
  Motion: a photo's double tap lands without a spring. Afterwards `sim-cleanup.mjs` removed everything, verified empty
  (no users, chats, chat files or story photos left).
- **Fixed from those checks:** at large text sizes the avatar's initials ran out of the circle (now sized to the circle,
  `allowFontScaling={false}`), a chat video's duration and a grid's "+N" covered the tile and the Reels rail's "Share"
  wrapped in two (now capped, one line); the cleanup left a chat's photos and videos in storage (now removed with it). The
  accessibility pass added: controls that never fade with VoiceOver on (`useScreenReader`), hidden controls and a
  stepped-aside rail leaving the accessibility tree, and "Double speed" announced.
- **Not checked:** VoiceOver itself (the iOS Simulator has none, and Accessibility Inspector did not attach to Expo Go
  there: its audit and its inspection came back empty), a real iPhone, Android (no emulator on the Mac), a voice message
  (its bar is unchanged but for the bottom room, which is now fixed). On the iOS 26 Simulator Reanimated did not find the
  keyboard's view, so the bar did not follow a finger swiping the keyboard down (it went down once the keyboard did, as
  with the old KeyboardAvoidingView); worth trying on a phone. On a screen with a native navigation bar, iOS 26 blurred a
  list moved up by a transform (its scroll-edge effect); the chat screen has no native bar, so it does not apply there.

## Next steps

1. The owner reviews the pull request (and tries it in Expo Go on his phone: `npx expo start --go --lan` from
   `apps/mobile`), above all VoiceOver and the keyboard swipe on a real iPhone. He confirmed on 2026-11-15 that a photo's
   double tap in the viewer zooms and the feed's likes.
2. On his word he merges it (that deploys the website and CampConnect Admin, unchanged by it); an EAS update to testers
   is a separate production write that waits for his approval (check the fingerprint first: no native change here).
3. Once merged: a short summary in `docs/history.md`, this file deleted, the branch deleted.

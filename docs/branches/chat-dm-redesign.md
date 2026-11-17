# chat-dm-redesign

- **Owner:** Sunil. **As of 2026-11-15:** branched from `main` after PR #112 (`632fec2`); the work is in the working
  tree, **not committed or pushed** (the owner has not asked for a commit yet). Written by an AI session.
- **Purpose:** the owner's brief: redesign the in-chat messaging experience with Instagram's DMs as inspiration but a
  UniBuzz identity of its own (Apple-like and premium): elegant bubbles, beautifully shown photos and videos, clean
  spacing and type, smooth motion, and a floating message bar with microphone, gallery and stickers. Videos in chats play
  with their sound **on**, with **no** mute button or sound switch, and keep play/pause, scrubbing and 2× while held.
  Everything existing in messages, privacy and Snaps stays. The screenshot he mentioned did not come through; Instagram's
  DM layout was the reference. App only: no migration, no native change.
- **Also the bottom bar** (the owner's second brief the same day, 2026-11-15): Instagram's clean bar, icons only, for Home,
  Explore, Create, Messages and Profile, every existing destination kept. His choices when asked: Events moves to a
  calendar in Home's top bar (beside the magnifier and the bell, opening the same Events screen), and Orbit's floating
  "+" goes (the bar's Create replaces it). It could be split into its own branch at commit time if the owner prefers.
- **Then the bar's look and the camera** (third brief, 2026-11-15, from a reference screenshot of another app's bar): a
  frosted, semi-transparent glass pill with bold icons, symmetric spacing, a subtle highlight on the tab on screen and
  smooth motion, in light and dark, the same five icons without labels; and the camera opened by Create lands on SNAP,
  its modes in the order BUZZ | SNAP | POST | REEL, SNAP centred, swiping kept, nothing else changed.
- **Then the bar's icons and highlight as in his own screenshot** (fourth brief, 2026-11-15: a screenshot of the bar his
  phone's older build draws, from 2026-10-25, with labels): its pill, outlined icons, aurora-washed capsule and the plain
  plus in a thin aurora ring, without the labels, every function kept. Kept from the approved round: the frosted glass,
  five equal places (the old bar widened the tab on screen, which put the "+" off centre), Create landing on SNAP.
- **Then the profile's facts** (fifth brief, 2026-11-15, from a screenshot of his own profile): University, Major,
  Graduation Year and Bio in a clean, aligned, symmetrical layout with consistent spacing and clear hierarchy, light
  and dark, nothing else changed; then (sixth) no labels, shown directly "in a beautiful aesthetic cool way"; then
  (seventh) not the card: he picked option C of three mock-ups, in the text's own colours.
- **Then the full-screen viewers on black** (eighth brief, 2026-11-16, from a TikTok screenshot): pure black (#000000)
  round every photo and video in the full-screen viewer, Reels and posts alike, each in its own shape with no
  stretching, cropping or distortion, edge to edge, the same in light and dark, nothing else changed.
- **Then swipes and sound in the viewer** (ninth brief, 2026-11-16, from a screenshot of a multi-photo post): a swipe on
  the last photo must never close the viewer, only a swipe to the right on the first photo; smooth, precise swipes with
  edge resistance and no accidental dismissals or conflicts; every video and reel with its sound on by default, no
  mute button anywhere, consistent sound when moving between videos; nothing else changed.
- **Then the viewer's words** (tenth brief, 2026-11-16, from a screenshot of a photo post with a gap under its caption):
  the name, caption and link placed like TikTok's, anchored at the bottom, adjusting to short or long words and an
  optional link, tight even spacing and no empty band under the last line, clear of the bottom bar and the rail,
  nothing else changed.
- **Then the camera's beauty filters** (eleventh brief, 2026-11-16, from a TikTok camera screenshot): three looks as
  round thumbnails (Natural Glow, Warm Beauty, Bright Radiance), live previews, adjustable intensity, the same effect in
  what is captured, front and rear lenses, iOS and Android, nothing else changed. **Scope agreed with the owner**
  (AskUserQuestion, 2026-11-16): photos now (POST, SNAP, listings), not recorded video, since expo-camera records the
  file itself and filtered video needs custom native camera code and a new build; he chose "Photos now".
- Also carries `chat-redesign`'s post-merge docs (its summary in `docs/history.md`, its notes file removed, its row in
  `docs/branches/README.md`, its `docs/status.md` entry marked merged).

## What changed

- **Bubbles** (`message-bubble.tsx`, `palette.ts`, `theme.ts`): mine on UniBuzz's aurora, its blue into its indigo
  corner to corner (`bubbleMine` `#166fe5 → #5468ee` light, `#1877f2 → #5468ee` dark; `bubbleMineFill`; white words 4.7
  and 4.6:1 in light), also for voice messages and call rows; theirs the neutral grey as before.
- **Faces** (`message-bubble.tsx`, `chat-header.tsx`, `app/messages/[id].tsx`): the other side's face (28pt) beside the
  last message of each of their runs, level with its bottom. One-to-one chats use the header's face through the new
  `chatPeerFace` (an anonymous poster's mask while hidden, a business's logo, never a staff member's photo; the header's
  `ChatPhoto` uses it too); groups use each sender's (a tap opens the profile). This replaces "no photos beside the
  bubbles" from `chat-redesign`.
- **Stickers** (`packages/shared/src/stickers.ts`, `sticker-sheet.tsx`, `composer.tsx`): a sticker is a message of one
  to three emoji and nothing else (`jumboEmoji`; flags, keycaps and joined emoji count as one), drawn large with no bubble
  and popping in with a small bounce. The sheet (reactions, campus life, moods, recent ones first, kept in AsyncStorage)
  sends one at once through the chat's own send (`sendSticker`, answering the quoted message like a voice message) and
  leaves the typed words in the field. Allowed for an anonymous poster (they are words).
- **Message bar** (`composer.tsx`): "+" (photo or video, camera, file) as before; at the capsule's end three tools,
  stickers, photos (the library at once) and the microphone; typing or picking swaps them for the aurora Send, the slot's
  width gliding (200ms) with the field. The sticker tool draws the outlined Ionicons smiley: SF's face symbols draw
  filled on the dark capsule.
- **Photos and videos in the chat** (`attachment-grid.tsx`): 18pt corners (as a shared post's and a Snap's), a hairline
  edge (`mediaEdge`), a glass play button and a glass duration pill with a video glyph.
- **Chat videos** (`media-viewer.tsx`): sound on, always (`muted = false`); the sound button is gone; play or pause, the
  timeline with its times and the 2× hold stay; the close button and counter are clear glass. Snaps already played once
  with sound and had no switch. Reels and the feed keep their one sound switch (not part of this brief).

- **Bottom bar** (`floating-tab-bar.tsx`, `app/(tabs)/_layout.tsx`, `lib/tab-bar.ts`, `palette.ts`, `glass.tsx`): no
  labels; five equal places (Home, Explore | Create | Messages, Profile), Create exactly in the middle. 60pt tall (66
  with labels before), 14pt in from the sides. Frosted glass: `GlassBackdrop` has a new `tabs` variant (liquid glass on
  iOS 26, the system blur before it, over a see-through `tabFill` wash, 0.74; solid with Reduce Transparency), a
  hairline edge and a soft `boxShadow` (drawn outside the pill only, so the glass is not darkened). As in the owner's
  screenshot (the bar of 2026-10-25, commit `2dcc26f`, minus its labels): each icon is the outlined SF symbol at rest
  in `colors.muted`, filled and in the text colour on the tab on screen, 26pt (about 19pt of ink); the capsule is washed
  with the aurora (`auroraGradient(colors.auroraWash, 110)`), 6pt in from the bar's top and bottom and 2pt from its
  ends, gliding on two edge springs (LEAD/TRAIL, leading edge ahead), instant with Reduce Motion, fading as the bar
  collapses; Create is the plain SF `plus` (18pt, regular) inside a 36pt aurora ring stroked 1.5pt, seen through a
  masked view (brand blue where an older build has none), nothing filled. Your photo is 22pt, ringed with the aurora on
  Profile. The badge is the system's plain red pill (no ring). Screen readers hear every place, Create counted: "Home,
  tab, 1 of 5", "Create, 3 of 5", "Messages, tab, 4 of 5, 3 new" (the unread count is now in the label; before,
  VoiceOver never read the badge). The collapse to a circle on a flick, the copy of the bar over the full-screen viewer
  and its middle action keep working. (The round before used filled icons, a neutral capsule and `plus.app.fill`; the
  `tabActive` and `tabIdle` colours went with it.)
- **Profile: university, major, year** (`components/profile/profile-header.tsx`, app only; the website keeps its "CS ’28
  @ Texas State University" line): the university pill and "Computer Science · '28" went through a labelled spec sheet
  and a student card (both turned down) to the owner's pick of three mock-ups shown side by side (option C, "same
  colours, not blue"): under the handle, the university in bold (17/22, text colour), the major and the class year under
  it in grey ("Computer Science · ’28": a faint dot, the year in semibold text colour), then the bio, then the numbers'
  card as before. No labels, no box, no icons; what is missing drops out. Read out as one line ("Texas State
  University, Computer Science, class of 2028"). Settings → Major & class year still previews the website's line.
- **Media on black** (`components/home/reel-item.tsx`, `app/reels/[id].tsx`, `components/messages/media-viewer.tsx`,
  `app/snap/[id].tsx`): the blurred, dimmed copy of the picture behind it is gone (`BlurredBackdrop` and
  `src/components/blurred-backdrop.tsx` deleted, with the small video frames made only for it); what a picture leaves is
  `colors.mediaBg` (#000000 in both themes). One placement, `fitWhole` (behind `photoLayout`, `placeVideo` and
  `wholeVideo`): whole, as big as the page allows, centred both ways. Vertical videos are no longer cropped to fill a
  phone taller than 9:16 (black above and below instead), and photos and videos no longer sit at the top in the viewer
  (`atTop` dropped); the viewer's zoom opens and closes on the same centred picture. On the Reels tab, the full-screen
  viewer, the chat's media viewer and a Snap. Stories (already on black) and the Snap camera's preview are unchanged.
- **Viewer swipes** (`lib/viewer-swipe.ts`): `swipeChoice` no longer turns a swipe past a carousel's last photo, or one
  in from the left edge (24pt), into the pull that closes the viewer. Only a swipe to the right on the first photo (or on
  a page with one picture) pulls back; past the last photo the strip stretches against the edge (`RUBBER` 0.3) and
  springs back; a back pull turned round to the left only stretches; letting go closes only past 30% of the width or on
  a flick to the right after at least 40pt (`BACK_FLICK_MIN`). Zoom, scrubbing, two fingers and up/down still take the
  touch first, and taps right after a swipe still do nothing, as before.
- **Sound on, no switch** (`lib/video-sound.ts`, `photo-carousel.tsx`, `reel-item.tsx`, `app/reels/[id].tsx`,
  `ads/sponsored-reel.tsx`): the one shared mute switch (muted to start) became `VIDEO_MUTED = false`; the sound buttons
  of feed videos, the Reels tab and viewer (beside the play button when paused) and sponsored reels are gone, the play
  button back in the dead centre. Already one video plays at a time (each feed's visible row, the page on screen, paused
  when covered or in the background), so nothing overlaps. Left as they were: the Snap camera's preview switch (the
  sender's own take), chat thumbnails and the compose cover picker (silent previews), and the website.
- **The viewer's words** (`reel-item.tsx`, `app/reels/[id].tsx`): the words no longer share the rail's 31pt lift
  (`OVERLAY_PAD`, kept by the rail alone): their last line sits `WORDS_GAP` (10pt) over the bottom inset on a photo,
  `WORDS_OVER_TIMELINE` (the timeline's 30pt touch band and 2pt) on a video, gliding between the two in 220ms on the UI
  thread when a post's slides change kind (at once with Reduce Motion), and growing upward, in their own column beside
  the rail (no `paddingBottom` under them any more). The viewer's bottom inset dropped the 58pt kept for the old
  "Add comment…" bar: `tabBarInset + 4` where the tab bar is drawn (was 92pt, now 86pt on the 16e), else the home
  indicator's area and 16pt (`BOTTOM_ROOM`; was 92pt, now 50pt). The Reels tab keeps its inset.
- **Beauty filters** (new: `packages/shared/src/beauty.ts` + tests, `apps/mobile/src/lib/beauty-gl.ts`,
  `beauty-photo.ts`, `beauty-store.ts`, `src/components/compose/beauty-row.tsx`, `beauty-preview.tsx`; changed:
  `app/compose/index.tsx`; **new dependency `expo-gl` ~58.0.4**). The looks are numbers in shared (smooth, brighten,
  warmth, saturation, glow, contrast), scaled by one intensity (0 to 1, 0.65 to start, smoothing capped at 0.8); the
  shader smooths with a 32-sample edge-keeping blur in four rings, masked to skin-tone chroma (any shade) and keeping a
  fifth of the skin's texture, then glow, midtone lift, white balance, saturation and contrast. One shader for the live
  picture and the photo: iOS draws a GL view over the camera's preview fed by `createCameraTextureAsync` (frames arrive
  upright and mirrored: the back lens is mirrored back); the photo is drawn off-screen as it is taken
  (`applyBeautyToPhoto`), and a phone that cannot draw it keeps the camera's own photo and says so. UI: sparkles on the
  right rail opens the row (None + three swatch thumbnails, white ring, name, slider); the choice is kept per device.
  Android has no live preview yet (could not be built or tried here), and REEL/video shows a note instead of the row.
  **Traps found:** expo-gl queues its commands, so `gl.flushEXP()` must run before `takeSnapshotAsync` or the promise
  never settles (that cost an hour); the snapshot needs `flip: true` to come out upright (both platforms agree).
- **Camera lands on SNAP** (`app/compose/index.tsx`, `mode-switcher.tsx`, `create-menu.ts`, `compose-nav.ts`): the
  modes run BUZZ | SNAP | POST | REEL; the bar's Create opens on SNAP (`openCompose(router, "snap")`, a fresh post
  started behind it), while your circle in the story tray and Upload in the menu under your photo still open on POST,
  where a story is shared (the publish screen's Your story). The row now slides so the chosen mode sits in the middle
  (SNAP centred on launch), its dot fixed under it, and its ends dissolve through a mask (solid steps, as
  ProgressiveBlur's; each word dims as a whole on an older build without the masked view) so far words never run into
  the Upload and Drafts buttons, whose slots went from 56 to 46pt to make room. Swiping across the stage still changes
  mode, and now a swipe along the row does too. BUZZ's X returns to the mode the camera opened on (SNAP from Create,
  POST otherwise). The listing camera (Explore's "+") keeps its fixed label.
- **Events off the bar** (`app/events/index.tsx`, moved from `app/(tabs)/events.tsx`; `header-actions.tsx`,
  `home-top-tabs.tsx`, `_layout.tsx`): Home's top bar has a calendar before the magnifier and the bell; it pushes the same
  screen (For you | All events, search, pills, Saved, its "+" for a new event), now with Back, no bottom bar
  (`InTabsContext` false: lists and the "+" keep only the safe area clear) and no collapse. Old links to `/events` open it.
- **Orbit's floating "+" removed** (`for-you-section.tsx`). Buzz keeps its pen, Explore its "+" for a new listing,
  Events its "+" for a new event, the menu under your photo its Upload, and your circle in the story tray adds a story.
- The website is unchanged: its bars keep the Events tab and their labels.

## Checked

- `npm run test:shared`: 306/306 (four new in `stickers.test.mjs`). `npm run check`: 9/9 (2026-11-15; the first run hit
  "No space left on device" on the Mac, the second passed after the web apps' `.next` was cleared).
- On the iOS Simulator (iPhone 16e, iOS 26.3, Expo Go), with a temporary development screen of the real rows and bar on
  sample messages (no account, no data; deleted again), light and dark: runs of bubbles with their faces, the aurora
  bubbles, a reply, photos and a two-tile block with a video's poster, glass play button and length, stickers large
  without a bubble and their pop on sending, the bar's three tools, Send in their place while typing, the sticker sheet,
  and the chat's video viewer without a sound button.
- Bottom bar on the same Simulator, signed out, light and dark (2026-11-15): the five icons and no labels, each tab
  switching (Home, Explore, Messages, Profile) with its icon filled, Create opening the login screen, the calendar opening
  Events with Back and no bar and Back returning to Home, the collapse to Home's circle on a flick and a tap bringing the
  bar back, the bar's copy over the full-screen viewer. Typecheck and `npm run check` 9/9 again.
- Signed in on **staging** (2026-11-15; `sim-seed.mjs` with `STAGING_SUPABASE_REF`, the test account given a sample photo
  URL, Metro on 8082 with staging's public keys, `dev-login`): all five places, dark and light. Home, Explore, Messages
  and Profile each open with their icon filled; your photo is the Profile icon, ringed on Profile; the Messages badge
  read 3 (right for the seed), dropped to 2 on opening Maya's chat, rose to 3 and then 12 live as Maya sent more (the
  two-digit badge fits); Create opened the camera (Expo Go's camera prompt, then the shutter, BUZZ | POST | REEL | SNAP;
  the Simulator has no live camera) and closing it returned to the tab, and the same from the bar over the full-screen
  viewer; the calendar opened Events with the campus's events. The accessibility tree read "Home, tab, 1 of 5",
  "Explore, tab, 2 of 5", "Create, 3 of 5" (with its hint), "Messages, tab, 4 of 5, 12 new", "Profile, tab, 5 of 5".
  Then logged out (the menu under your photo) and `sim-cleanup.mjs`: no profile, account or seeded chat left. The Maestro flows
  (`00-signed-out`, `01-signed-in`, `02-reels-and-create`) were updated for the calendar and Create, **not run**
  (Maestro is not installed on this Mac).
- The new bar and the camera (2026-11-15, the same Simulator; signed out on the live project for the bar alone, signed
  in on **staging** for the rest: seeded, a sample photo, Metro on 8082, then logged out and `sim-cleanup.mjs`, nothing
  left): the bar in dark and light over photos and a white page, the capsule caught mid-glide between Messages and
  Profile and landing, the collapse (capsule fades) and the tap back, your photo ringed on the capsule, the red badge,
  the accessibility labels unchanged. Create opened the camera on SNAP, centred, BUZZ left and POST right, REEL
  dissolving at the edge; swipes across the stage went to POST then REEL, swipes along the row back to POST, SNAP and
  BUZZ; BUZZ's X came back to SNAP; the shutter on SNAP made the Simulator's test picture and opened the Snap preview
  with Send To (closed, nothing sent); the story tray's circle and Upload opened on POST (Upload's library asked for
  photo access, declined); the roommate listing camera kept its "ROOMMATE POST" label. `npm run check` 9/9,
  `npm run test:shared` 306/306. The Maestro flows were updated for SNAP, not run.
- Media on black on the Simulator (2026-11-16, signed out, the live project's public posts and reels, read only):
  a photo in the viewer whole and centred (spanning 275.7 to 568.3pt, its middle the screen's 422pt), pixels above and
  below it #000000 in dark and light; a screen-shaped video filling the screen untrimmed; landscape reels on the Reels
  tab whole in the middle on black; the chat's viewer (a temporary screen with a sample photo and a 16:9 video, deleted
  again) both centred on black. Not seen: a 9:16 reel (none in the data; by the code it is as wide as the screen with
  75pt of black above and below on the 16e), a Snap (needs a real one; same code as the chat's viewer).
  `npm run check` 9/9.
- The viewer's words on the Simulator (2026-11-16, test-pattern posts from a temporary screen, deleted again, and a live
  post read-only): without the tab bar a name only, or a short caption, ends 62 to 64pt over the screen's bottom (was
  about 104); a title, a long caption and a link end at 68pt, the link pill last, and opened in full grow upward from
  there in their own column; on a mixed post the words sit on the photo's line and rise just over the timeline on the
  video; with the tab bar (a live photo post from Home) the caption ends 99pt up, about 17pt over the bar (the
  owner's screenshot showed about 45pt). The rail stays put on every slide.
- Beauty filters on the Simulator (2026-11-16/17; the Simulator has no camera, so the live picture could not be seen):
  the photo path run on three stock portraits of different skin tones at full intensity, each beside its original —
  pores and uneven patches even out while eyelashes, lips, eyeliner, a mole and hair stay sharp; 1080 x 1920 in about
  2.6s in debug (a release build and a real photo will differ). The UI: the row opens from the sparkles, Warm Beauty
  rings and names itself, the slider reads 8/32/75 as it is dragged (x=300 of a 64..364 track gives 75), the choice
  survives a full reload, REEL shows "Filters are for photos; a video records as it is.", and the accessibility tree
  reads every thumbnail with its hint. One test image looked green until it was converted from ProPhoto RGB to sRGB:
  the image's profile, not the filter. `npm run check` 9/9, `npm run test:shared` 317/317 (13 new).
- **Not tested:** the live preview (needs a phone), Android at all, a real camera photo, and how it looks on faces the
  owner knows. The testers' installed build has no expo-gl: it shows no sparkles until a new build.
- Swipes and sound on the Simulator (2026-11-16, test-pattern posts in the real viewer from a temporary screen, deleted
  again): on a three-photo post, left, left to the last photo; a hard left swipe there stays (frame by frame: 320pt of
  finger moves it about 87pt, then it springs back in about 0.4s with no overshoot); a right swipe from the very left
  edge goes to photo 2, another to photo 1, and only the next one closes the viewer. On a one-photo post, a left swipe,
  a quick 30pt flick and a slow 70pt pull all leave it open; a full right swipe closes it. A paused reel shows only the
  play button, dead centre; the accessibility tree (viewer, Orbit with a video post) has no sound or mute control.
  Sound itself cannot be heard in the Simulator: on a phone.
- Media on black, measured (2026-11-16, the owner's request to verify every shape and viewer): test patterns made on
  the Mac (a red border at the very edge: cropping cuts it; a white circle: stretching makes it an oval; videos with a
  moving marker), 9:16, 16:9 and 1:1, photo and video, served to the Simulator from the Mac. Posts (a temporary screen
  opening the real viewer on sample posts and reels, deleted again), Reels, the chat's viewer, and Snaps (on **staging**:
  six Snaps from a seeded friend through `send_snap`, each opened once as the recipient; then logged out,
  `sim-cleanup.mjs`, nothing left). Every one whole and centred on #000000, to the point: 9:16 390 × 693.3pt with 75.3pt
  of black above and below, 16:9 390 × 219.3pt at 312.3pt, 1:1 390 × 390pt at 227pt; all four border sides present;
  every circle round (ratio 1.000 ± 0.006); videos playing. Frame by frame (a screen recording), the viewer's zoom
  opens the picture smoothly to its centred place in about 270ms and a swipe up eases the next reel into its centred
  place. Overlays: the rail on the right, the name, caption and timeline at the bottom over the black, Back and the
  dots at the top; the chat video's play button in the middle, its timeline at the bottom; a Snap's progress bar,
  sender and close at the top, "Tap anywhere to close" at the bottom. The glass buttons over a portrait picture's top
  edge refract its colour (Liquid Glass, as designed). Real phones: not tested by the session (as before: the iPhone's
  UniBuzz is a release build, no Expo Go there, no Android tools). `npm run check` 9/9, the website rebuilt uncached.
- Profile, the chosen option on the Simulator (2026-11-15, signed out, a public profile on the live project, read
  only), dark and light. The three mock-ups came from a temporary development screen (deleted again).
- Measured again after the screenshot round (2026-11-15, dark and light, signed out): every icon within 0.2pt of its
  place's centre on the bar's centre line, the ring 36pt round the bar's centre, symbols about 19pt; Create opened the
  login screen signed out; the collapse fades the capsule and the ring; the accessibility labels unchanged. Not signed
  in this round (the photo's 22pt and the badge are the screenshot's own code).
- Measured, the round before (2026-11-15, the owner's request to test everything on real phones; screenshots and screen recordings of the
  Simulator, read with two small Swift tools in the session's scratchpad): every icon on the bar's centre line (792pt
  on the 16e) and within 0.3pt of its place's centre in light and dark (before the fix, all sat 0.4 to 0.6pt right: the
  bar's hairline border pushed the row and capsule in on one side only; their offsets now take the hairline off);
  symbol ink 20 to 21.7pt; the capsule 230.3 to 300.7pt on a slot of 230.2 to 300.6pt, vertically on the bar's centre;
  contrast of idle icons 7:1 (light) and 8.6:1 (dark) on the bar, the active icon 11:1 and more on its capsule. Frame
  by frame, the capsule glides on every frame and settles in about 450ms. On a tab's **first** visit the whole screen
  holds for 0.2 to 0.3s while it is built (development mode, Simulator) before the switch and the glide; starting the
  glide on the tap was tried and dropped (it then reappears most of the way along). Reduce Transparency: a solid bar;
  Reduce Motion: the capsule jumps. Signed in on staging again (seeded, a sample photo, then logged out and
  `sim-cleanup.mjs`, nothing left): the photo's new size, the badge, Create on SNAP centred, swipes on the stage and
  the row, BUZZ's X back to SNAP, the story tray on POST.
- **Real phones: not tested by the session.** The owner's iPhone 17 Pro (iOS 26.2) is paired with the Mac, but its
  UniBuzz is a release build that runs only its own JavaScript or published updates (no development launcher, no Expo
  Go installed), and the Mac's tools can launch apps there but neither see nor touch the screen; an EAS update would be a
  production write. No Android tools (adb, emulator, SDK) are on the Mac. The owner can check on the iPhone with Expo
  Go from the App Store and the session's QR, or a development build (`npm run ios:device`, his call: about 3.6GB free).
- **Not checked:** emoji themselves (this Simulator draws every emoji as a "?" box, everywhere in the app; a phone draws
  them), sending a sticker on an account, the faces in a group and an anonymous chat, a real camera (a phone), VoiceOver
  itself (the labels were read from the accessibility tree), Android.

## Decisions to record with the PR (docs/decisions.md)

- A sticker is a message of one to three emoji (no new message kind, nothing new stored), so every reader and rule
  treats it as words.
- The other side's face sits beside their runs (reverses `chat-redesign`'s "no photos beside the bubbles"); in a
  one-to-one chat it is always the header's face.
- Videos in chats play with their sound on and have no sound switch; feed videos keep the shared switch.
- Rewrite "The app's bottom bar is Home, Explore, Messages, Events, Profile…" (2026-10-31): the app's bar is icons only,
  Home, Explore, Create, Messages, Profile (owner, 2026-11-15, Instagram's bar); Events is the calendar in Home's top bar
  and For you has no floating "+". The website keeps its Events tab. Also update `docs/status.md` (Home's "floating '+'
  on Orbit", the Events entry's "the bar is Home, Explore, Messages, Events, Profile").
- The bar's Create opens the camera on SNAP, modes BUZZ | SNAP | POST | REEL (owner, 2026-11-15); the story tray and
  Upload stay on POST because stories are shared from the post flow. Also update `docs/status.md`'s Create flow line
  ("BUZZ | POST | REEL | SNAP since 2026-10-30").
- The profile shows the university in bold and "major · ’year" under it, no labels, above the bio (owner's pick,
  2026-11-15), amending the profile layout he chose on 2026-10-31.
- The bar is frosted see-through glass with no labels, five equal places, outlined icons filled on the tab on screen,
  an aurora-washed gliding capsule and Create as a plus in a thin aurora ring (owner, 2026-11-15: his screenshot of the
  bar from 2026-10-25, labels removed), after a filled-icon round the same day.

- Videos play with their sound on, no switch, replacing the one shared switch muted to start (owner, 2026-11-16); the
  viewer closes sideways only from the first photo, to the right (owner, 2026-11-16), replacing "past the first or last
  photo, or from the left edge".
- Rewrite "Every full-screen photo and video viewer in the app … fills the rest with a blurred, dimmed copy … never
  black" (2026-11-01): every full-screen viewer (posts and reels, the Reels tab, chat media, Snaps) shows each picture
  whole in its own shape, centred, on pure black in both themes, TikTok's way, vertical videos included, never cropped
  (owner, 2026-11-16).

- The camera's beauty filters are for photos only (POST, SNAP, listings), not recorded video (owner's choice,
  2026-11-16): expo-camera writes the video file itself, so a filtered recording needs custom native camera code and a
  new build, which Expo Go cannot run.
- The filters smooth skin by colour, not by finding faces: nothing about a face is detected, reshaped or stored, and
  the smoothing keeps part of the skin's own texture (owner's brief: no excessive blurring, no changed features).

## Next steps

1. The owner looks at it on his phone (Expo Go through the tunnel QR from this session, or `npx expo start --go --lan`
   from `apps/mobile`) and says what to change; he may send the screenshot he meant to attach.
2. On his word: commit, push, the decisions above, `docs/testing.md` results, the PR (it also carries `chat-redesign`'s
   post-merge docs); an EAS update to testers is a separate production write.

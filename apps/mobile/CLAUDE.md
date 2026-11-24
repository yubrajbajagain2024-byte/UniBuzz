# apps/mobile/ — Expo app instructions

The iOS and Android app: Expo SDK 58, React Native 0.88, expo-router. The root
[CLAUDE.md](../../CLAUDE.md) has the shared rules; [README.md](README.md) explains each screen,
device builds and store releases.

## Layout

```
src/app/(tabs)/   index (Home: Orbit | Buzz, Orbit a card feed under the story tray, a tap opening a post full screen), events, messages, profile; the bar is icons only,
                  Create in its middle (_layout.tsx)
src/app/housing.tsx  Explore (Housing | Roommate | Marketplace), pushed from the compass in Home's top bar
src/app/search.tsx  the search screen (people, topics, posts, what is popular): the magnifier beside the bell
src/app/compose/  the create flow behind Create and every "+": camera → edit → publish; listing, listing-form,
                  listing-preview for roommate posts and Marketplace items
src/app/create/   per-kind entry points: post, reel, buzz, apartment, roommate, item
src/app/…         buzz, messages, posts, reels, apartments, roommates, marketplace, profile, follows,
                  call, snap, stories, topics, settings, notifications, saved, find-people, events
                  (an event, saved, interests, new, edit; the For you | All events screen is the tab),
                  organizations (page, new, edit, members), (auth)/forgot-password,
                  reset-password (a recovery link that opens the app; Change password)
src/lib/          app-only helpers: calls.ts, home-scope.ts, stories-store.ts, event-saves-store.ts,
                  organization-follows-store.ts, campus-time-zone.ts, supabase.ts, dev-overrides.ts, …
e2e/              Maestro flows (flows/*.yaml, run.sh), seed and lifecycle scripts
```

## Commands (from `apps/mobile/`)

```bash
npx expo start              # a development build (calls need one); add --go --tunnel for Expo Go
npm run ios:device          # scripts/ios-device.mjs: a free signed build on your own iPhone
npm run typecheck
npx eas-cli@latest update --channel preview --environment preview   # publish JS to installed builds
```

- **Run every Expo and EAS command from `apps/mobile/`.** At the repo root EAS finds no project
  and writes a stub `app.json` there (it happened on 2026-10-26; see
  docs/branches/business-portal-prelaunch.md), and `npx expo start` writes `.expo/` and a stub
  `tsconfig.json` there (2026-11-15). Delete such stubs; never commit them.
- `eas update` publishes JavaScript only. A change to native configuration (`app.json` plugins,
  permissions, SDK) needs a new native build; `npx eas-cli@latest build:list` shows which exist.
  The runtime version is the native fingerprint, so an update reaches only builds with the same
  native code: before publishing, `npx eas-cli@latest fingerprint:compare --build-id <id>` against
  the testers' build should say the fingerprints match.
- Publishing an update reaches real testers, so it is a production write.

## Configuration

- `app.json` plus `app.config.js`, which reads `CAMPCONNECT_BUNDLE_ID` and
  `CAMPCONNECT_FREE_SIGNING` at build time.
- Developer-only settings go in the git-ignored `.env.local`, never in the committed `.env`.

## Flags kept in the code

Why each exists: [docs/decisions.md](../../docs/decisions.md).

- `CALLS_PAUSED` (`src/lib/calls.ts`): calls are off and hidden (no call button, ring, banner or call
  screen; past calls are history rows) unless `EXPO_PUBLIC_CALLS_ENABLED=1`. Check it in any new
  call entry point, and never bundle that variable into a build without the owner's decision.
  Since migration 66 went live (2026-11-05) the database refuses new calls too: turning calls on also takes its
  rollback.
- `SCOPE_TOGGLE_SHOWN = false` (`src/lib/home-scope.ts`): the Campus | Global toggle is hidden.
- `HIDDEN_HOME_SECTIONS = ["posts"]` (`packages/shared/src/constants.ts`, read by the website's
  Home too): Posts has no Home tab. The app's own row is `APP_HOME_TABS` in `src/lib/home-tabs.ts`
  (Orbit | Buzz): Reels has no tab in the app either, Orbit carrying it, while the website
  keeps its Reels tab. Orbit is the card feed (`components/home/for-you-section.tsx`, `stories-tray.tsx`);
  the full-screen Orbit of 2026-11-21 to 11-24 and its folding stories row are kept
  (`orbit-section.tsx`, `stories-row.tsx`): nothing mounts them.
- `EXPO_PUBLIC_BUZZ_FIXTURES=<variant>` in `.env.local`: development only, answers Buzz from
  sample data.

## Media, gestures and the keyboard

- A photo that zooms uses `src/components/zoomable.tsx`; a video's timeline and its "2×" pill are
  `src/components/video-controls.tsx` (1× always, 2× only while a finger is held on it). In the
  full-screen viewer a double tap on a photo zooms it; in the feeds a double tap likes (`photoDoubleTap`); on the
  full-screen Orbit (unmounted since 2026-11-24) a pinch also sprang back and left the page clear (TikTok's)
  ([docs/decisions.md](../../docs/decisions.md)).
- A bar that rides the keyboard (the chat's message bar, a story's reply row) moves by Reanimated's
  `useAnimatedKeyboard` and a transform (`keyboardLift` in `src/components/messages/composer.tsx`),
  not a KeyboardAvoidingView, and needs no new native module, so an EAS update still reaches it.
- Gesture Handler inside a React Native `Modal` needs its own `GestureHandlerRootView` in it.
- Every video plays with its sound on and there is no mute or sound button (`VIDEO_MUTED` in
  `src/lib/video-sound.ts`): keep one video playing at a time, paused when its screen is covered.
- The full-screen viewer has no Back button: it is left by a swipe to the right from the screen's
  left edge, or one on a post's first photo (`swipeChoice` in `src/lib/viewer-swipe.ts`). On Home's
  Orbit a sideways swipe moves between a post's photos and, once it leaves them, is handed to the
  pager of sections (`useSectionPager`), so Buzz is always a swipe away. Keep a way out
  of every page.
- The camera's beauty filters are for photos only: the camera records video itself, where the shader
  cannot reach. The looks are numbers in `packages/shared/src/beauty.ts`, the shader and GL in
  `src/lib/beauty-gl.ts`; expo-gl is optional, so check `BEAUTY_AVAILABLE` and never import it at a
  module's top (an older build reading an update over the air does not have it).
- A sticker is a message of one to three emoji (`jumboEmoji` in `packages/shared`): never a new
  message kind, so every reader and rule keeps treating it as words.

## End-to-end checks

- **Signed-in checks run on staging, never the live project.** `SUPABASE_ACCESS_TOKEN=…
  STAGING_SUPABASE_REF=… node e2e/sim-seed.mjs` makes three throwaway students with posts, two chats
  and a story, and prints the test login (**without `STAGING_SUPABASE_REF` it seeds production**).
  Start Metro with staging's `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in the
  environment (they win over `.env`), sign in with
  `exp://<host>:<port>/--/dev-login?email=…&password=…&to=<route>&theme=light|dark`, and clean up with
  `node e2e/sim-cleanup.mjs` (it follows the seed's project). The token goes on the command line only.
- A temporary development screen under `src/app/` with sample data is fine for a look; never commit it.
- The iOS Simulator has no VoiceOver: check VoiceOver on a real iPhone.
- Simulator: `e2e/run.sh e2e/flows/00-signed-out.yaml` (Maestro), with data from
  `node e2e/sim-seed.mjs`; remove it afterwards with `node e2e/sim-cleanup.mjs`.
- `e2e/snap-lifecycle.mjs` and `e2e/call-lifecycle.mjs` run between two real accounts.
- **Without a staging ref these scripts create throwaway accounts and data on the live project**
  (they need `SUPABASE_ACCESS_TOKEN`), so they are production writes. Always clean up afterwards.

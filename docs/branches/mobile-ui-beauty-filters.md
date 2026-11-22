# `mobile-ui-beauty-filters`

Sunil's mobile line since 2026-11-16, branched from `main` after PR #112 (`chat-redesign`). **Not merged**;
no PR open yet as of 2026-11-21. Everything here is the app only: the website and the database are untouched.

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
- **The Home redesign** (2026-11-21, uncommitted as of this writing): Stories | Orbit | Buzz, Orbit a full-screen
  TikTok-style feed, the bottom bar Home, Events, Create, Messages, Profile, Explore moved to the compass in Home's top
  bar. See docs/decisions.md for the choices and apps/mobile/README.md for how it works.
- **The stories viewer** (2026-11-21, uncommitted): edge to edge on black like Orbit, with a cube turn between people.

## State

- `npm run check` 9/9 and `npm run test:shared` 316/316 green on 2026-11-21.
- Looked at on the iPhone 16e Simulator (iOS 26.3, Expo Go over a tunnel) on 2026-11-21: all three Home tabs, the pager
  both ways, Orbit's vertical paging, Events as a tab, Explore from the compass, and the stories viewer on a temporary
  dev route with sample groups (deleted again). Not checked on a real phone or on Android.
- An EAS preview update (`da62c538-1b0c-4127-8773-c35f94fb7a17`) was published to the preview channel on 2026-11-21
  from `7e75ea9`, with the owner's approval. **Nothing since then has been published**, so the testers' build does not
  have the Home or stories redesign.

## Pending

- The Maestro flow `01-signed-in.yaml` still drives the card feed Orbit replaced, and `04-posts-look.yaml` needs a
  Posts tab the app has not had since `HIDDEN_HOME_SECTIONS`. Both say so at the top of the file. Maestro is not
  installed on the owner's Mac, so neither has been run.
- The shared files (docs/status.md, docs/testing.md, docs/branches/README.md) are left for the PR, after `main` is
  merged in (root CLAUDE.md, "Documentation: keep it current", rule 2).
